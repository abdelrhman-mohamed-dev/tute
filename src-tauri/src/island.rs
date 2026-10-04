// The island's window: a borderless, transparent, always-on-top window at the
// top centre of its display, that never takes focus unless a text field needs
// the keyboard. The page draws the tile inside it.
//
// It has two sizes: the full panel (room for the biggest view) and, while the
// island is hidden, a thin invisible strip along the top edge that wakes it.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

pub const WINDOW_LABEL: &str = "island";

/// The full panel, logical px: the biggest view fits.
pub const PANEL: (f64, f64) = (720.0, 320.0);
/// The wake strip, logical px: thin enough to never be in the way.
const STRIP: (f64, f64) = (240.0, 6.0);

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Puts the window at the top centre of its display: the panel, or the strip when `folded`.
pub fn place(app: &AppHandle, pref: &str, folded: bool) {
    let (Some(win), Some(screen)) = (window(app), crate::display::choose(app, pref)) else { return };
    let k = screen.scale_factor();
    let (w, h) = if folded { STRIP } else { PANEL };
    let size = PhysicalSize::new((w * k).round().max(1.0) as u32, (h * k).round().max(1.0) as u32);
    let at = PhysicalPosition::new(
        screen.position().x + (screen.size().width as i32 - size.width as i32) / 2,
        screen.position().y,
    );
    let _ = win.set_size(size);
    let _ = win.set_position(at);
    // A move onto a display with another scale resizes the window: size it again.
    let _ = win.set_size(size);
    let _ = win.set_always_on_top(true);
}

/// Mouse events pass through the window to whatever is under it (or don't).
pub fn pass_clicks(app: &AppHandle, through: bool) {
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(through);
    }
}

fn hwnd(win: &WebviewWindow) -> Option<HWND> {
    // Tauri's HWND comes from its own `windows` version: go through the raw value.
    let raw = win.hwnd().ok()?.0 as isize;
    (raw != 0).then(|| HWND(raw as *mut _))
}

fn change_style(win: &WebviewWindow, add: isize, remove: isize) {
    let Some(h) = hwnd(win) else { return };
    unsafe {
        let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, (style | add) & !remove);
    }
}

/// Clicking the island never steals focus from your app, and it stays out of Alt-Tab.
pub fn stay_unfocused(win: &WebviewWindow) {
    change_style(win, WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize, 0);
}

/// While a view has a text field the island may take the keyboard; then it lets go.
pub fn take_keyboard(win: &WebviewWindow, take: bool) {
    let no_activate = WS_EX_NOACTIVATE.0 as isize;
    if take {
        change_style(win, 0, no_activate);
        let _ = win.set_focus();
    } else {
        change_style(win, no_activate, 0);
    }
}
