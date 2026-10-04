// The drop catcher: how files dragged onto the island get in.
//
// The webview can't take them reliably. WebView2 registers drop targets of
// its own on its child windows (some from another process, out of reach), and
// which one wins changes between versions and from moment to moment, so files
// are often refused with the "no" cursor.
//
// So while a file is dragged over the island, a native window of ours, the
// catcher, lies on top of it: invisible, but hit-testable, with our drop target
// as the only one on it. It forwards the drag to the page as `file-drag`
// events (enter / over / leave / drop). watch.rs puts it up and takes it down;
// the rest of the time it's hidden and takes nothing.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::sync::atomic::{AtomicIsize, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{implement, w, Ref, Result};
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINTL, WPARAM};
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY,
    DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragFinish, DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, RegisterClassW, SetLayeredWindowAttributes, SetWindowPos,
    ShowWindow, HWND_TOPMOST, LWA_ALPHA, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WNDCLASSW,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use crate::island::WINDOW_LABEL;

/// The catcher's window handle; 0 until it's made.
static WINDOW: AtomicIsize = AtomicIsize::new(0);

fn window() -> Option<HWND> {
    let raw = WINDOW.load(Ordering::Relaxed);
    (raw != 0).then(|| HWND(raw as *mut _))
}

#[derive(Serialize, Clone)]
struct FileDrag {
    #[serde(rename = "type")]
    kind: &'static str,
    paths: Vec<String>,
}

fn tell_page(app: &AppHandle, kind: &'static str, paths: Vec<String>) {
    if kind != "over" {
        crate::log::line(format!("drop: {kind}, {} file(s)", paths.len()));
    }
    let _ = app.emit_to(WINDOW_LABEL, "file-drag", FileDrag { kind, paths });
}

/// The files being dragged, or `None` for anything else (text, a link…).
fn dragged_files(data: Ref<'_, IDataObject>) -> Option<Vec<String>> {
    let wanted = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let medium = unsafe { data.as_ref()?.GetData(&wanted) }.ok()?;
    let drop = HDROP(unsafe { medium.u.hGlobal.0 });
    let name = |i: u32| {
        let len = unsafe { DragQueryFileW(drop, i, None) } as usize;
        let mut buf = vec![0u16; len + 1];
        unsafe { DragQueryFileW(drop, i, Some(&mut buf)) };
        OsString::from_wide(&buf[..len]).to_string_lossy().into_owned()
    };
    let files: Vec<String> = (0..unsafe { DragQueryFileW(drop, u32::MAX, None) }).map(name).collect();
    // GetData gave us our own copy of the list; this frees it.
    unsafe { DragFinish(drop) };
    (!files.is_empty()).then_some(files)
}

fn answer(effect: *mut DROPEFFECT, value: DROPEFFECT) {
    if let Some(effect) = unsafe { effect.as_mut() } {
        *effect = value;
    }
}

#[implement(IDropTarget)]
struct Target {
    app: AppHandle,
}

impl IDropTarget_Impl for Target_Impl {
    fn DragEnter(&self, data: Ref<'_, IDataObject>, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        match dragged_files(data) {
            Some(files) => {
                answer(effect, DROPEFFECT_COPY);
                tell_page(&self.app, "enter", files);
            }
            None => {
                answer(effect, DROPEFFECT_NONE);
                crate::log::line("drop: something without files came over");
            }
        }
        Ok(())
    }

    fn DragOver(&self, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        // Windows resets the effect before each call; only files got this far.
        answer(effect, DROPEFFECT_COPY);
        Ok(())
    }

    fn DragLeave(&self) -> Result<()> {
        tell_page(&self.app, "leave", Vec::new());
        Ok(())
    }

    fn Drop(&self, data: Ref<'_, IDataObject>, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        match dragged_files(data) {
            Some(files) => {
                answer(effect, DROPEFFECT_COPY);
                tell_page(&self.app, "drop", files);
            }
            None => {
                answer(effect, DROPEFFECT_NONE);
                tell_page(&self.app, "leave", Vec::new());
            }
        }
        Ok(())
    }
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

/// Makes the (hidden) catcher. Once, on the main thread: OLE needs the thread
/// that owns the window, and Tauri's main thread is the one with OLE set up.
pub fn create(app: &AppHandle) {
    if let Err(why) = try_create(app) {
        crate::log::line(format!("drop: no catcher ({why})"));
    }
}

fn try_create(app: &AppHandle) -> std::result::Result<(), String> {
    unsafe {
        let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        let instance = HINSTANCE(module.0);
        let class = w!("TuteCatcher");
        RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class,
            ..Default::default()
        });
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
            class,
            w!("Tute catcher"),
            WS_POPUP,
            0,
            0,
            1,
            1,
            None,
            None,
            Some(instance),
            None,
        )
        .map_err(|e| e.to_string())?;
        // Alpha 1 of 255: nothing to see, but still a window Windows will hit.
        // Fully transparent (or WS_EX_TRANSPARENT) and the drag falls through.
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 1, LWA_ALPHA);
        let target: IDropTarget = Target { app: app.clone() }.into();
        RegisterDragDrop(hwnd, &target).map_err(|e| e.to_string())?;
        WINDOW.store(hwnd.0 as isize, Ordering::Relaxed);
    }
    Ok(())
}

/// Lays the catcher over a screen rect (physical px: x, y, width, height), on top.
pub fn cover((x, y, w, h): (i32, i32, i32, i32)) {
    if let Some(hwnd) = window() {
        unsafe {
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
}

pub fn hide() {
    if let Some(hwnd) = window() {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
}
