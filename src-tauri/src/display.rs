// The displays: which ones are connected, which one the island lives on (the
// `screen` setting), and how big it is.
//
// The setting is "primary", "cursor" (whichever display the mouse is on when
// the island is placed) or "monitor:<device name>" to pin one display. A pinned
// display that's been unplugged falls back to the primary one.

use serde::Serialize;
use tauri::{AppHandle, Monitor};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

const PINNED: &str = "monitor:";

/// A display's area in logical pixels, and its scale (what the page gets at boot).
#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// One display, as the settings window offers it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// What goes in the `screen` setting to pin it.
    pub id: String,
    pub label: String,
    pub primary: bool,
}

/// The cursor in physical screen pixels.
pub fn cursor() -> Option<(i32, i32)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x, p.y))
}

fn holds(m: &Monitor, (x, y): (i32, i32)) -> bool {
    let (p, s) = (m.position(), m.size());
    (p.x..p.x + s.width as i32).contains(&x) && (p.y..p.y + s.height as i32).contains(&y)
}

/// The display the island goes on, for the `screen` setting `pref`.
pub fn choose(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let all = app.available_monitors().ok()?;
    let pinned = pref
        .strip_prefix(PINNED)
        .and_then(|name| all.iter().find(|m| m.name().is_some_and(|n| n == name)));
    let under_cursor = (pref == "cursor")
        .then(cursor)
        .flatten()
        .and_then(|c| all.iter().find(|m| holds(m, c)));
    pinned
        .or(under_cursor)
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| all.into_iter().next())
}

pub fn screen(app: &AppHandle, pref: &str) -> ScreenInfo {
    let Some(m) = choose(app, pref) else {
        return ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 };
    };
    let k = m.scale_factor();
    ScreenInfo {
        x: m.position().x as f64 / k,
        y: m.position().y as f64 / k,
        width: m.size().width as f64 / k,
        height: m.size().height as f64 / k,
        scale: k,
    }
}

/// Everything that, when it changes, means the island must be placed again:
/// where its display is, how big, at what scale.
pub fn fingerprint(app: &AppHandle, pref: &str) -> Option<(i32, i32, u32, u32, u64)> {
    let m = choose(app, pref)?;
    let (p, s) = (m.position(), m.size());
    Some((p.x, p.y, s.width, s.height, m.scale_factor().to_bits()))
}

/// The connected displays, labelled "Display 2 — 2560×1440 (main)".
pub fn list(app: &AppHandle) -> Vec<MonitorInfo> {
    let Ok(all) = app.available_monitors() else { return Vec::new() };
    let main = app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    all.iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let name = m.name()?;
            // Windows names them `\\.\DISPLAY2`; show the number, or the position if odd.
            let digits = name.rsplit("DISPLAY").next().unwrap_or("");
            let number = if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
                digits.to_string()
            } else {
                (i + 1).to_string()
            };
            let primary = main.as_deref() == Some(name.as_str());
            let size = m.size();
            Some(MonitorInfo {
                id: format!("{PINNED}{name}"),
                label: format!(
                    "Display {number} — {}×{}{}",
                    size.width,
                    size.height,
                    if primary { " (main)" } else { "" }
                ),
                primary,
            })
        })
        .collect()
}
