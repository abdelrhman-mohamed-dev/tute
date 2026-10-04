// Watches the cursor for the island while it's on screen, on a thread of its
// own. Each tick it:
//
//   - tells the page where the cursor is (`cursor`, in window coordinates),
//   - lets clicks through everywhere except over the island, so the big
//     transparent window never blocks what's under it,
//   - spots a file being dragged in from elsewhere and puts the drop catcher
//     up (see catcher.rs),
//   - notices when the displays change and asks the page to place the island
//     again (`screen-changed`).
//
// It ticks at 60 Hz near the island, 20 Hz with the cursor far away, and while
// the island is hidden it sleeps on a condvar: no ticks at all.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

use crate::island::{self, PANEL, WINDOW_LABEL};

/// Around the island, this much still counts as on it (logical px). Generous:
/// a click meant for the island must never fall through to the app below.
const MARGIN: f64 = 14.0;
/// Further than this from the panel, the cursor is "far" and ticks slow down.
const NEAR: f64 = 200.0;
const TICK_NEAR: Duration = Duration::from_millis(16);
const TICK_FAR: Duration = Duration::from_millis(50);
/// Displays are checked every this many ticks (about twice a second).
const DISPLAY_EVERY: u32 = 30;

/// The island's outline in window coordinates, as the page last reported it.
#[derive(Clone, Copy, Default)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Area {
    fn holds(&self, x: f64, y: f64) -> bool {
        self.w > 0.0
            && (self.x - MARGIN..=self.x + self.w + MARGIN).contains(&x)
            && (self.y - MARGIN..=self.y + self.h + MARGIN).contains(&y)
    }
}

pub struct Watcher {
    awake: Mutex<bool>,
    bell: Condvar,
    /// The window is the wake strip (the island is hidden).
    pub folded: AtomicBool,
    area: Mutex<Area>,
    /// Clicks currently pass through the window. Kept to call Win32 only on a change.
    passing: AtomicBool,
}

impl Watcher {
    pub fn new() -> Self {
        Self {
            awake: Mutex::new(false),
            bell: Condvar::new(),
            folded: AtomicBool::new(true),
            area: Mutex::new(Area::default()),
            passing: AtomicBool::new(false),
        }
    }

    pub fn set_area(&self, area: Area) {
        *self.area.lock().unwrap() = area;
    }

    /// Starts or stops the ticks.
    pub fn wake(&self, on: bool) {
        *self.awake.lock().unwrap() = on;
        self.bell.notify_all();
    }

    /// After a resize the window's click-through state is unknown: set it again next tick.
    pub fn resync(&self) {
        self.passing.store(false, Ordering::Relaxed);
    }

    fn is_awake(&self) -> bool {
        *self.awake.lock().unwrap()
    }

    fn sleep_until_awake(&self) {
        let mut awake = self.awake.lock().unwrap();
        while !*awake {
            awake = self.bell.wait(awake).unwrap();
        }
    }
}

#[derive(Serialize, Clone)]
struct Cursor {
    x: f64,
    y: f64,
}

fn left_button_down() -> bool {
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 }
}

/// One look at the cursor and the window.
struct Glance {
    /// The cursor in window coordinates (logical px).
    x: f64,
    y: f64,
    /// The window: its size (logical), top-left (physical) and scale.
    w: f64,
    h: f64,
    origin: (i32, i32),
    scale: f64,
}

impl Glance {
    fn take(app: &AppHandle) -> Option<Self> {
        let win = island::window(app)?;
        let origin = win.outer_position().ok()?;
        let scale = win.scale_factor().unwrap_or(1.0);
        let (cx, cy) = crate::display::cursor()?;
        let (w, h) = win
            .inner_size()
            .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
            .unwrap_or(PANEL);
        Some(Self {
            x: (cx - origin.x) as f64 / scale,
            y: (cy - origin.y) as f64 / scale,
            w,
            h,
            origin: (origin.x, origin.y),
            scale,
        })
    }

    fn over_window(&self) -> bool {
        (0.0..=self.w).contains(&self.x) && (0.0..=self.h).contains(&self.y)
    }

    fn far(&self) -> bool {
        self.x < -NEAR || self.x > self.w + NEAR || self.y > self.h + NEAR
    }

    /// The window in physical screen pixels, for the catcher.
    fn screen_rect(&self) -> (i32, i32, i32, i32) {
        let (x, y) = self.origin;
        (x, y, (self.w * self.scale).round() as i32, (self.h * self.scale).round() as i32)
    }
}

/// The left button, followed across ticks: was it pressed over the window, or
/// somewhere else (a file picked up in Explorer, on the desktop…)?
#[derive(Default)]
struct Press {
    down: bool,
    from_elsewhere: bool,
}

impl Press {
    fn follow(&mut self, down: bool, over_window: bool) {
        if down && !self.down {
            self.from_elsewhere = !over_window;
        }
        self.down = down;
    }
}

pub fn spawn(app: AppHandle, watcher: Arc<Watcher>) {
    std::thread::spawn(move || {
        let mut press = Press::default();
        let mut catching = false;
        // Kept across sleeps, so a display that changed while hidden is caught on wake.
        let mut displays = None;
        loop {
            watcher.sleep_until_awake();
            let mut last: Option<(f64, f64)> = None;
            let mut ticks = 0u32;
            let mut far = false;
            while watcher.is_awake() {
                std::thread::sleep(if far { TICK_FAR } else { TICK_NEAR });
                ticks = ticks.wrapping_add(1);
                if ticks % DISPLAY_EVERY == 0 {
                    check_displays(&app, &mut displays);
                }

                let Some(g) = Glance::take(&app) else { continue };
                far = g.far();
                let down = left_button_down();
                // A still cursor needs nothing, unless the button changed: a
                // release must take the catcher down even with no movement after.
                let still = last.is_some_and(|(x, y)| (g.x - x).abs() < 1.0 && (g.y - y).abs() < 1.0);
                if still && down == press.down {
                    continue;
                }
                last = Some((g.x, g.y));

                press.follow(down, g.over_window());
                // While the button is held over the window, all of it takes the
                // mouse: a dragged file can only find a window that's hit-testable.
                let held_here = down && g.over_window();

                // Something picked up elsewhere is over us: up goes the catcher.
                let want_catcher = held_here && press.from_elsewhere;
                if want_catcher != catching {
                    catching = want_catcher;
                    let rect = g.screen_rect();
                    let _ = app.run_on_main_thread(move || {
                        if want_catcher {
                            crate::catcher::cover(rect);
                        } else {
                            crate::catcher::hide();
                        }
                    });
                }

                let take = held_here || watcher.area.lock().unwrap().holds(g.x, g.y);
                if watcher.passing.load(Ordering::Relaxed) == take {
                    watcher.passing.store(!take, Ordering::Relaxed);
                    island::pass_clicks(&app, !take);
                }

                let _ = app.emit_to(WINDOW_LABEL, "cursor", Cursor { x: g.x, y: g.y });
            }
        }
    });
}

/// Displays get plugged in, unplugged, rearranged and rescaled; an island left
/// at coordinates that no longer exist can't be reached. On any change, the
/// page is asked to place it again.
fn check_displays(app: &AppHandle, last: &mut Option<(i32, i32, u32, u32, u64)>) {
    let now = crate::display::fingerprint(app, &crate::screen_pref(app));
    if now.is_none() || now == *last {
        return;
    }
    let first = last.is_none();
    *last = now;
    if !first {
        crate::log::line("displays changed: placing the island again");
        let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
    }
}
