// The inbox: %LOCALAPPDATA%\Tute\inbox. A dropped file is copied in here, so
// the original is never touched and the copy outlives wherever it came from.
// Copies older than a week are cleared out whenever a new one arrives.

use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

const WEEK: Duration = Duration::from_secs(7 * 24 * 3600);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

pub fn dir() -> PathBuf {
    crate::settings::local_dir().join("inbox")
}

/// `name`, or `name (2)`, `name (3)`… — the first that isn't taken in `dir`.
fn free_name(dir: &Path, source: &Path) -> PathBuf {
    let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..1000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// Copies `source` into the inbox.
pub fn take(source: &str) -> Result<DroppedFile, String> {
    let from = Path::new(source);
    let meta = std::fs::metadata(from).map_err(|e| format!("Can't read {source}: {e}"))?;
    if meta.is_dir() {
        return Err("Folders can't be dropped yet.".into());
    }
    let inbox = dir();
    std::fs::create_dir_all(&inbox).map_err(|e| e.to_string())?;
    let to = free_name(&inbox, from);
    std::fs::copy(from, &to).map_err(|e| format!("Can't copy it: {e}"))?;
    // Windows copies the timestamps too: a file last edited years ago would
    // arrive "older than a week" and be cleared at once. Its age is ours.
    if let Ok(file) = std::fs::File::options().write(true).open(&to) {
        let _ = file.set_modified(SystemTime::now());
    }
    clear_old(&inbox);
    Ok(DroppedFile {
        name: to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: to.to_string_lossy().into_owned(),
        size: meta.len(),
    })
}

/// Deletes an inbox copy (Cancel on the card). Nothing else, whatever the page
/// asks: the path must be a plain file name directly in the inbox, compared as
/// written (not resolved, since Windows may redirect AppData to two real paths).
pub fn discard(path: &str) -> Result<(), String> {
    let file = Path::new(path);
    let plain = matches!(file.components().next_back(), Some(Component::Normal(_)));
    if !plain || file.parent() != Some(dir().as_path()) || !file.is_file() {
        return Err("Only files in the inbox can be deleted.".into());
    }
    std::fs::remove_file(file).map_err(|e| format!("Can't delete it: {e}"))
}

/// Removes copies that landed more than a week ago.
fn clear_old(inbox: &Path) {
    let Ok(entries) = std::fs::read_dir(inbox) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let landed = entry.metadata().and_then(|m| m.modified());
        if landed.is_ok_and(|t| now.duration_since(t).is_ok_and(|age| age > WEEK)) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("tute-inbox-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn copies_without_overwriting() {
        let d = scratch("copy");
        let src = d.join("note.txt");
        std::fs::write(&src, "one").unwrap();
        let a = take(src.to_str().unwrap()).unwrap();
        std::fs::write(&src, "two").unwrap();
        let b = take(src.to_str().unwrap()).unwrap();
        assert_ne!(a.path, b.path);
        assert_eq!(std::fs::read_to_string(&a.path).unwrap(), "one");
        assert_eq!(std::fs::read_to_string(&b.path).unwrap(), "two");
        assert!(b.name.starts_with("note ("), "second copy is {}", b.name);
        assert!(take(d.to_str().unwrap()).is_err(), "a folder was taken");
        discard(&a.path).unwrap();
        discard(&b.path).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn deletes_only_inside_the_inbox() {
        let d = scratch("discard");
        let outside = d.join("keep.txt");
        std::fs::write(&outside, "mine").unwrap();
        assert!(discard(outside.to_str().unwrap()).is_err());
        assert!(outside.exists());
        let sneaky = dir().join("..").join("tute.log");
        assert!(discard(sneaky.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_old_file_arrives_new() {
        let d = scratch("age");
        let src = d.join("ancient.txt");
        std::fs::write(&src, "old").unwrap();
        let long_ago = SystemTime::now() - WEEK - Duration::from_secs(3600);
        std::fs::File::options().write(true).open(&src).unwrap().set_modified(long_ago).unwrap();
        let copy = take(src.to_str().unwrap()).unwrap();
        assert!(Path::new(&copy.path).exists(), "a fresh copy was cleared as a week old");
        discard(&copy.path).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }
}
