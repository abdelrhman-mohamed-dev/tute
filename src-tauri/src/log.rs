// Tute's log: %LOCALAPPDATA%\Tute\tute.log, one timestamped line per event.
// It stays on this machine. Past about a megabyte it starts over.

use std::io::Write;

use windows::Win32::System::SystemInformation::GetLocalTime;

const MAX_BYTES: u64 = 1 << 20;

pub fn line(message: impl AsRef<str>) {
    let dir = crate::settings::local_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("tute.log");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::remove_file(&path);
    }
    let t = unsafe { GetLocalTime() };
    if let Ok(mut log) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(
            log,
            "{}-{:02}-{:02} {:02}:{:02}:{:02} {}",
            t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond,
            message.as_ref()
        );
    }
}
