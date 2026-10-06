// Tute's icon in the notification area, and its menu: Open, Settings, Pause,
// Quit. Quit and Settings are handled here; Open and Pause go to the island
// as `tray` events (src/main.ts).

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

/// A flat white jelly with its eyes cut out, as raw 32×32 RGBA pixels: a plain
/// glyph like the other tray icons. Drawn by scripts/gen-icons.mjs.
const ICON: &[u8] = include_bytes!("../icons/tray-32.rgba");
const ICON_SIZE: u32 = 32;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let line = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[
            &item("open", "Open Tute")?,
            &line()?,
            &item("settings", "Settings…")?,
            &item("pause", "Pause")?,
            &line()?,
            &item("quit", "Quit")?,
        ],
    )?;

    TrayIconBuilder::with_id("tute")
        .icon(Image::new(ICON, ICON_SIZE, ICON_SIZE))
        .tooltip("Tute")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            other => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", other.to_string());
            }
        })
        .build(app)?;
    Ok(())
}
