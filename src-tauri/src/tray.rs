// Notification-area icon: Open, Settings, Pause, Quit.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

/// A flat white jelly with its eyes cut out, as raw 32×32 RGBA pixels: a plain
/// glyph like the other tray icons. Drawn by scripts/gen-icons.mjs.
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-32.rgba");
const TRAY_SIZE: u32 = 32;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Tute", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open, &sep1, &settings, &pause, &sep2, &quit])?;

    TrayIconBuilder::with_id("tute")
        .icon(Image::new(TRAY_ICON, TRAY_SIZE, TRAY_SIZE))
        .tooltip("Tute")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        })
        .build(app)?;
    Ok(())
}
