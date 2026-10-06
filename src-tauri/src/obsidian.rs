// Obsidian. A vault is a folder of Markdown files, so Tute works with it
// directly: no plugin, no account, no network. It follows the vault's own
// settings, the daily note's folder, date format and template
// (.obsidian/daily-notes.json) and where attachments go (.obsidian/app.json),
// and opens notes in Obsidian with its `obsidian://` links.
//
// Every write stays inside the chosen vault, and only Markdown notes and
// copied attachments are ever written.

use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use windows::Win32::System::SystemInformation::GetLocalTime;

/// A vault Obsidian knows about.
#[derive(Serialize, Clone)]
pub struct Vault {
    pub name: String,
    pub path: String,
}

/// A note found by a search.
#[derive(Serialize, Clone)]
pub struct Found {
    /// Its path inside the vault, with forward slashes.
    pub path: String,
    pub title: String,
    /// A line around the match, if it matched inside.
    pub snippet: Option<String>,
}

/// What a capture or a saved file did.
#[derive(Serialize, Clone)]
pub struct Added {
    /// The daily note it went into, inside the vault.
    pub note: String,
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ── Vaults ────────────────────────────────────────────────────────────────────

/// The vaults Obsidian has opened on this PC (its own list, in %APPDATA%).
pub fn vaults() -> Vec<Vault> {
    let Some(appdata) = std::env::var_os("APPDATA") else { return Vec::new() };
    let file = PathBuf::from(appdata).join("obsidian").join("obsidian.json");
    let Ok(text) = std::fs::read_to_string(file) else { return Vec::new() };
    let Ok(json) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    let mut list: Vec<(i64, Vault)> = json["vaults"]
        .as_object()
        .map(|all| {
            all.values()
                .filter_map(|v| {
                    let path = v["path"].as_str()?;
                    Path::new(path).is_dir().then(|| (v["ts"].as_i64().unwrap_or(0), vault_at(path)))
                })
                .collect()
        })
        .unwrap_or_default();
    // The one used most recently first.
    list.sort_by(|a, b| b.0.cmp(&a.0));
    list.into_iter().map(|(_, v)| v).collect()
}

fn vault_at(path: &str) -> Vault {
    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string());
    Vault { name, path: path.to_string() }
}

/// The chosen vault, if it's still there.
fn root(vault: Option<&str>) -> Result<PathBuf, String> {
    let path = vault.ok_or("Choose your Obsidian vault first (Settings → Connections).")?;
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("Your Obsidian vault isn't there anymore. Choose it again in Settings.".into());
    }
    Ok(root)
}

/// Checks a folder is a vault (it has the `.obsidian` settings folder) and names it.
pub fn check(path: &str) -> Result<Vault, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err("That folder doesn't exist.".into());
    }
    if !p.join(".obsidian").is_dir() {
        return Err("That folder isn't an Obsidian vault (it has no .obsidian folder). Open it in Obsidian once first.".into());
    }
    Ok(vault_at(path))
}

/// `rel` inside `root`, or an error if it would step outside it.
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel.trim_start_matches(['/', '\\']));
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("That path isn't inside the vault.".into());
    }
    Ok(root.join(rel))
}

fn read_json(file: PathBuf) -> Value {
    std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

// ── Dates, the way Obsidian writes them ───────────────────────────────────────

struct Now {
    year: u16,
    month: u16,
    day: u16,
    weekday: u16, // 0 = Sunday
    hour: u16,
    minute: u16,
}

fn now() -> Now {
    let t = unsafe { GetLocalTime() };
    Now { year: t.wYear, month: t.wMonth, day: t.wDay, weekday: t.wDayOfWeek, hour: t.wHour, minute: t.wMinute }
}

const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// Formats a date with the Moment.js tokens Obsidian's daily notes use
/// (YYYY, YY, MMMM, MMM, MM, M, DD, D, Do, dddd, ddd, HH, mm; [text] is literal).
fn format_date(pattern: &str, t: &Now) -> String {
    const TOKENS: [&str; 13] = ["YYYY", "YY", "MMMM", "MMM", "MM", "M", "Do", "DD", "D", "dddd", "ddd", "HH", "mm"];
    let mut out = String::new();
    let mut rest = pattern;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('[') {
            let end = after.find(']').unwrap_or(after.len());
            out.push_str(&after[..end]);
            rest = after.get(end + 1..).unwrap_or("");
            continue;
        }
        let Some(token) = TOKENS.iter().find(|tok| rest.starts_with(**tok)) else {
            let c = rest.chars().next().unwrap();
            out.push(c);
            rest = &rest[c.len_utf8()..];
            continue;
        };
        let month = MONTHS[(t.month as usize).saturating_sub(1) % 12];
        let day = DAYS[t.weekday as usize % 7];
        out.push_str(&match *token {
            "YYYY" => t.year.to_string(),
            "YY" => format!("{:02}", t.year % 100),
            "MMMM" => month.to_string(),
            "MMM" => month[..3].to_string(),
            "MM" => format!("{:02}", t.month),
            "M" => t.month.to_string(),
            "Do" => format!("{}{}", t.day, match (t.day % 10, t.day % 100) {
                (_, 11..=13) => "th",
                (1, _) => "st",
                (2, _) => "nd",
                (3, _) => "rd",
                _ => "th",
            }),
            "DD" => format!("{:02}", t.day),
            "D" => t.day.to_string(),
            "dddd" => day.to_string(),
            "ddd" => day[..3].to_string(),
            "HH" => format!("{:02}", t.hour),
            _ => format!("{:02}", t.minute),
        });
        rest = &rest[token.len()..];
    }
    out
}

// ── The daily note ────────────────────────────────────────────────────────────

/// Today's note, inside the vault: its path ("Daily/2026-10-04.md"), created
/// from the vault's daily-note template if it doesn't exist yet.
fn daily_note(root: &Path) -> Result<String, String> {
    let config = read_json(root.join(".obsidian").join("daily-notes.json"));
    let t = now();
    let format = config["format"].as_str().filter(|f| !f.trim().is_empty()).unwrap_or("YYYY-MM-DD");
    let folder = config["folder"].as_str().unwrap_or("").trim_matches(['/', '\\']);
    let name = format!("{}.md", format_date(format, &t));
    let rel = if folder.is_empty() { name } else { format!("{folder}/{name}") };
    let file = inside(root, &rel)?;
    if !file.exists() {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Can't make the daily notes folder: {e}"))?;
        }
        let title = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let template = config["template"]
            .as_str()
            .filter(|t| !t.trim().is_empty())
            .and_then(|t| inside(root, &if t.ends_with(".md") { t.to_string() } else { format!("{t}.md") }).ok())
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default()
            .replace("{{title}}", &title)
            .replace("{{date}}", &format_date("YYYY-MM-DD", &t))
            .replace("{{time}}", &format_date("HH:mm", &t));
        std::fs::write(&file, template).map_err(|e| format!("Can't create today's note: {e}"))?;
    }
    Ok(rel)
}

/// Adds a line to the end of today's note: "- 14:05 text".
fn append_line(root: &Path, line: &str) -> Result<String, String> {
    let rel = daily_note(root)?;
    let file = inside(root, &rel)?;
    let mut text = std::fs::read_to_string(&file).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&format!("- {} {line}\n", format_date("HH:mm", &now())));
    std::fs::write(&file, text).map_err(|e| format!("Can't write to today's note: {e}"))?;
    Ok(rel)
}

/// A thought, jotted into today's note.
pub fn capture(vault: Option<&str>, text: &str) -> Result<Added, String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("Nothing to add.".into());
    }
    let root = root(vault)?;
    Ok(Added { note: append_line(&root, &text)? })
}

/// Today's note, created if needed, then opened in Obsidian.
pub fn open_today(vault: Option<&str>) -> Result<(), String> {
    let root = root(vault)?;
    let rel = daily_note(&root)?;
    open_note(&root, &rel)
}

/// Opens a note of the vault in Obsidian.
pub fn open(vault: Option<&str>, rel: &str) -> Result<(), String> {
    let root = root(vault)?;
    if !inside(&root, rel)?.is_file() {
        return Err("That note isn't there anymore.".into());
    }
    open_note(&root, rel)
}

fn open_note(root: &Path, rel: &str) -> Result<(), String> {
    let vault = vault_at(&root.to_string_lossy()).name;
    let file = rel.strip_suffix(".md").unwrap_or(rel);
    let uri = format!("obsidian://open?vault={}&file={}", encode(&vault), encode(file));
    Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &uri])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Couldn't open Obsidian: {e}"))?;
    Ok(())
}

/// Percent-encodes everything but unreserved characters (RFC 3986).
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// ── Finding notes ─────────────────────────────────────────────────────────────

/// At most this many notes are looked at, and this much of each.
const SEARCH_FILES: usize = 5000;
const SEARCH_BYTES: u64 = 256 * 1024;
const RESULTS: usize = 6;

/// Notes whose name, then whose text, has every word of `query`.
pub fn search(vault: Option<&str>, query: &str) -> Result<Vec<Found>, String> {
    let root = root(vault)?;
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let mut notes = Vec::new();
    collect_notes(&root, &mut notes);

    let mut scored: Vec<(u8, std::time::SystemTime, Found)> = Vec::new();
    for file in notes {
        let rel = file.strip_prefix(&root).unwrap_or(&file).to_string_lossy().replace('\\', "/");
        let title = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let name = rel.to_lowercase();
        let changed = std::fs::metadata(&file).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
        if words.iter().all(|w| name.contains(w)) {
            scored.push((2, changed, Found { path: rel, title, snippet: None }));
            continue;
        }
        let small = std::fs::metadata(&file).is_ok_and(|m| m.len() <= SEARCH_BYTES);
        let Some(text) = small.then(|| std::fs::read_to_string(&file).ok()).flatten() else { continue };
        let lower = text.to_lowercase();
        if words.iter().all(|w| lower.contains(w.as_str())) {
            let snippet = text
                .lines()
                .find(|l| l.to_lowercase().contains(words[0].as_str()))
                .map(|l| l.trim().chars().take(120).collect());
            scored.push((1, changed, Found { path: rel, title, snippet }));
        }
    }
    // Name matches first, then the most recently changed.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    Ok(scored.into_iter().take(RESULTS).map(|(_, _, f)| f).collect())
}

fn collect_notes(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= SEARCH_FILES {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Hidden folders (.obsidian, .trash, .git) and dependency folders are skipped.
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect_notes(&path, out),
            Ok(t) if t.is_file() && name.to_lowercase().ends_with(".md") => out.push(path),
            _ => {}
        }
    }
}

// ── Saving a dropped file ─────────────────────────────────────────────────────

/// Copies a file from Tute's inbox into the vault's attachments folder, and
/// links it in today's note.
pub fn save_file(vault: Option<&str>, inbox_copy: &str) -> Result<Added, String> {
    let root = root(vault)?;
    let source = Path::new(inbox_copy);
    if source.parent() != Some(crate::inbox::dir().as_path()) || !source.is_file() {
        return Err("Only a file dropped on Tute can be saved to Obsidian.".into());
    }
    let today = daily_note(&root)?;
    let folder = attachments_folder(&root, &today)?;
    std::fs::create_dir_all(&folder).map_err(|e| format!("Can't make the attachments folder: {e}"))?;
    let to = free_name(&folder, source);
    std::fs::copy(source, &to).map_err(|e| format!("Can't copy it into the vault: {e}"))?;
    let name = to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Added { note: append_line(&root, &format!("![[{name}]]"))? })
}

/// Where the vault keeps attachments (Settings → Files and links in Obsidian):
/// the vault's root, next to the note ("./"), a folder next to it ("./x"), or a folder.
fn attachments_folder(root: &Path, note: &str) -> Result<PathBuf, String> {
    let setting = read_json(root.join(".obsidian").join("app.json"))["attachmentFolderPath"]
        .as_str()
        .unwrap_or("/")
        .to_string();
    let note_dir = Path::new(note).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let rel = match setting.as_str() {
        "" | "/" => String::new(),
        "./" | "." => note_dir,
        s if s.starts_with("./") => format!("{note_dir}/{}", &s[2..]),
        s => s.to_string(),
    };
    if rel.trim_matches('/').is_empty() { Ok(root.to_path_buf()) } else { inside(root, rel.trim_matches('/')) }
}

fn free_name(dir: &Path, source: &Path) -> PathBuf {
    let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let stem = source.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..1000).map(|n| dir.join(format!("{stem} {n}{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day() -> Now {
        Now { year: 2026, month: 10, day: 4, weekday: 0, hour: 9, minute: 5 }
    }

    #[test]
    fn dates_follow_obsidian_formats() {
        assert_eq!(format_date("YYYY-MM-DD", &day()), "2026-10-04");
        assert_eq!(format_date("YYYY/MMMM/DD MMM", &day()), "2026/October/04 Oct");
        assert_eq!(format_date("dddd, Do MMMM YY", &day()), "Sunday, 4th October 26");
        assert_eq!(format_date("[Week of] D/M", &day()), "Week of 4/10");
        assert_eq!(format_date("HH:mm", &day()), "09:05");
    }

    #[test]
    fn paths_stay_inside_the_vault() {
        let root = Path::new(r"C:\vault");
        assert!(inside(root, "Daily/2026-10-04.md").is_ok());
        assert!(inside(root, "/Daily/x.md").is_ok());
        assert!(inside(root, "../secrets.md").is_err());
        assert!(inside(root, r"C:\Windows\x.md").is_err());
    }

    #[test]
    fn a_vault_round_trip() {
        let vault = std::env::temp_dir().join(format!("tute-vault-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        std::fs::create_dir_all(vault.join("Templates")).unwrap();
        std::fs::write(vault.join("Templates").join("Day.md"), "# {{title}}\n").unwrap();
        std::fs::write(
            vault.join(".obsidian").join("daily-notes.json"),
            r#"{"folder":"Daily","format":"YYYY-MM-DD","template":"Templates/Day"}"#,
        )
        .unwrap();
        std::fs::write(vault.join("Ideas.md"), "Jelly sizes\nA bigger jelly for the bar").unwrap();
        let v = vault.to_string_lossy().into_owned();

        assert!(check(&v).is_ok());
        let added = capture(Some(&v), "  buy   oat milk ").unwrap();
        assert!(added.note.starts_with("Daily/"));
        let note = std::fs::read_to_string(vault.join(&added.note)).unwrap();
        assert!(note.starts_with("# ") && note.contains("buy oat milk"), "{note}");

        let found = search(Some(&v), "bigger jelly").unwrap();
        assert_eq!(found.first().map(|f| f.path.as_str()), Some("Ideas.md"));
        assert!(found[0].snippet.as_deref().unwrap_or("").contains("bigger"));
        assert_eq!(search(Some(&v), "ideas").unwrap()[0].snippet, None, "a name match has no snippet");

        assert!(save_file(Some(&v), &vault.join("Ideas.md").to_string_lossy()).is_err(), "only inbox files");
        let _ = std::fs::remove_dir_all(&vault);
    }
}
