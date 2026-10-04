// "Do it with Claude": starts Claude Code on this PC, in a visible console
// window, working on a Linear issue. Its questions and permission prompts reach
// the island through the hooks (claude.rs) like any other session.
//
// The issue's text is untrusted (anyone in the workspace can write it), so it
// never passes through a shell: claude.exe is started directly with the task as
// one argument. If only an npm `claude.cmd` exists, the task goes into a file
// and Claude gets just the file's path.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use windows::core::HSTRING;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

use crate::{log, settings};

/// A new console window of its own, so the user can watch and take over.
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

/// Windows' own folder picker. Blocks until the user picks or cancels, so call
/// it off the main thread.
pub fn pick_folder(title: &str) -> Option<String> {
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let picked = (|| -> windows::core::Result<String> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let options = dialog.GetOptions()?;
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
            dialog.SetTitle(&HSTRING::from(title))?;
            dialog.Show(None)?; // Cancel comes back as an error.
            let item = dialog.GetResult()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string();
            CoTaskMemFree(Some(name.0 as *const _));
            path.map_err(|_| windows::core::Error::from_win32())
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        picked.ok()
    }
}

/// Where `claude` lives: the real exe if there is one, else the npm wrapper.
fn find_claude() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // The installer's usual home, in case Tute was started without it on PATH.
    if let Some(home) = std::env::var_os("USERPROFILE") {
        dirs.push(PathBuf::from(home).join(".local").join("bin"));
    }
    for name in ["claude.exe", "claude.cmd"] {
        if let Some(found) = dirs.iter().map(|d| d.join(name)).find(|p| p.is_file()) {
            return Some(found);
        }
    }
    None
}

fn valid_issue_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Opens a console in `folder` running Claude Code on `task`.
pub fn launch(folder: &str, issue_id: &str, task: &str) -> Result<(), String> {
    if !Path::new(folder).is_dir() {
        return Err("That folder doesn't exist anymore. Pick it again.".into());
    }
    if !valid_issue_id(issue_id) {
        return Err(format!("Odd issue id {issue_id:?}"));
    }
    let claude = find_claude().ok_or("Claude Code isn't installed (no `claude` on this PC).")?;

    // Kept either way, so there's a record of what Claude was asked.
    let dir = settings::local_dir().join("tasks");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{issue_id}.md"));
    std::fs::write(&file, task).map_err(|e| format!("Can't save the task: {e}"))?;

    let is_exe = claude.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe"));
    let arg = if is_exe {
        task.to_string()
    } else {
        format!("Read the task in {} and do the work it describes.", file.display())
    };
    Command::new(&claude)
        .arg(arg)
        .current_dir(folder)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
    log::line(format!("agent: started Claude on {issue_id}"));
    Ok(())
}

/// What Claude is asked to do for an issue.
pub fn task_for(issue_id: &str, title: &str, url: &str, description: &str) -> String {
    let description = description.trim();
    let body = if description.is_empty() { "(No description.)" } else { description };
    format!(
        "Work on Linear issue {issue_id}: {title}\n{url}\n\n{body}\n\n\
         Do the work in this repository. Ask me if something important is unclear. \
         When you're done, end your last message with a short summary (2–4 sentences) \
         of what you changed — it will be posted as a comment on the issue."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_ids_are_checked() {
        assert!(valid_issue_id("DEV-2411"));
        assert!(!valid_issue_id("../x"));
        assert!(!valid_issue_id("a b"));
        assert!(!valid_issue_id(""));
    }

    #[test]
    fn task_starts_with_the_issue_for_session_linking() {
        let t = task_for("DEV-1", "Fix it", "https://linear.app/x", "");
        assert!(t.starts_with("Work on Linear issue DEV-1:"));
        assert!(t.contains("(No description.)"));
    }
}
