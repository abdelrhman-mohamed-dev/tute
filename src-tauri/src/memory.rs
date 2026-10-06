// What Tute keeps between chats, all on this PC (%APPDATA%\Tute):
//
//   chats\<id>.json  each chat, saved as it goes, named after its first question
//   memory.json      lasting things about the user: preferences, who they are,
//                    how they work. Listed in Settings → Memory, where they can
//                    be edited, deleted, added or switched off.
//
// The chat learns through small notes at the end of a reply (see `notes`):
// `⟦remember: …⟧` saves a memory, `⟦used: 2⟧` says which memory shaped the
// answer. They're cut out of the text before anyone sees it.

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// At most this many memories (oldest go first).
const MAX_MEMORIES: usize = 60;
/// A memory is a short line, not a story.
const MAX_MEMORY_CHARS: usize = 200;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn fresh_id() -> String {
    format!("{:x}{:04x}", now_ms(), std::process::id() as u16 ^ (now_ms() as u16).rotate_left(5))
}

/// Ids come from the page: only plain ones are used in file names.
fn plain(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

// ── Memories ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Memory {
    pub id: String,
    pub text: String,
    /// When it was saved (ms since 1970).
    pub at: u64,
}

fn memory_file() -> PathBuf {
    crate::settings::config_dir().join("memory.json")
}

pub fn memories() -> Vec<Memory> {
    std::fs::read(memory_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_memories(list: &[Memory]) -> Result<(), String> {
    std::fs::create_dir_all(crate::settings::config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(memory_file(), json).map_err(|e| format!("Can't save memory: {e}"))
}

fn tidy(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_MEMORY_CHARS).collect()
}

/// Saves a memory (unless the same thing is already known). Returns it.
pub fn remember(text: &str) -> Result<Memory, String> {
    let text = tidy(text);
    if text.is_empty() {
        return Err("Nothing to remember.".into());
    }
    let mut list = memories();
    if let Some(known) = list.iter().find(|m| m.text.eq_ignore_ascii_case(&text)) {
        return Ok(known.clone());
    }
    let memory = Memory { id: fresh_id(), text, at: now_ms() };
    list.push(memory.clone());
    let excess = list.len().saturating_sub(MAX_MEMORIES);
    list.drain(..excess);
    save_memories(&list)?;
    Ok(memory)
}

pub fn edit(id: &str, text: &str) -> Result<(), String> {
    let text = tidy(text);
    if text.is_empty() {
        return forget(id);
    }
    let mut list = memories();
    let memory = list.iter_mut().find(|m| m.id == id).ok_or("That memory is gone.")?;
    memory.text = text;
    save_memories(&list)
}

pub fn forget(id: &str) -> Result<(), String> {
    let mut list = memories();
    list.retain(|m| m.id != id);
    save_memories(&list)
}

pub fn forget_all() -> Result<(), String> {
    save_memories(&[])
}

/// The memories, as the chat's model reads them (numbered, for `⟦used: n⟧`).
pub fn for_model(list: &[Memory]) -> String {
    if list.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = list.iter().enumerate().map(|(i, m)| format!("{}. {}", i + 1, m.text)).collect();
    format!(
        "\n\nWhat you remember about the user from earlier chats (they can see and edit this list):\n{}",
        lines.join("\n")
    )
}

/// How the model is asked to remember, and to say what it used.
pub const MEMORY_RULES: &str = "\n\nMemory: when the user tells you something lasting about themselves (a preference, \
who they are, how they work, people or projects they care about), end your reply with a line \
⟦remember: <the fact, short, in third person>⟧, one per fact. Never for passing details, one-off questions or \
anything sensitive (health, passwords, money details). When one of the things you remember shaped your answer, end \
with ⟦used: <its number>⟧. These notes are hidden from the user, so don't mention them.";

// ── The notes at the end of a reply ───────────────────────────────────────────

/// What a reply's hidden notes said.
#[derive(Default, Debug, PartialEq)]
pub struct Notes {
    pub remember: Vec<String>,
    /// 1-based numbers into the memory list the model was given.
    pub used: Vec<usize>,
}

/// Splits a reply into its visible text and its notes (⟦…⟧ anywhere in it).
pub fn notes(reply: &str) -> (String, Notes) {
    let mut text = String::new();
    let mut notes = Notes::default();
    let mut rest = reply;
    while let Some(start) = rest.find('⟦') {
        text.push_str(&rest[..start]);
        let after = &rest[start + '⟦'.len_utf8()..];
        let Some(end) = after.find('⟧') else {
            rest = ""; // an unfinished note: drop it
            break;
        };
        let note = after[..end].trim();
        if let Some(fact) = note.strip_prefix("remember:") {
            let fact = tidy(fact);
            if !fact.is_empty() {
                notes.remember.push(fact);
            }
        } else if let Some(nums) = note.strip_prefix("used:") {
            notes.used.extend(nums.split(|c: char| !c.is_ascii_digit()).filter_map(|n| n.parse::<usize>().ok()));
        }
        rest = &after[end + '⟧'.len_utf8()..];
    }
    text.push_str(rest);
    (text.trim_end().to_string(), notes)
}

// ── Chats ─────────────────────────────────────────────────────────────────────

/// A saved chat. The messages are kept as the page sends them (text, sources,
/// memory chips), so the page can show them again exactly.
#[derive(Serialize, Deserialize, Clone)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub updated: u64,
    pub messages: Vec<Value>,
}

/// A chat in the list, without its messages.
#[derive(Serialize, Clone)]
pub struct ChatInfo {
    pub id: String,
    pub title: String,
    pub updated: u64,
}

fn chats_dir() -> PathBuf {
    crate::settings::config_dir().join("chats")
}

fn chat_file(id: &str) -> Result<PathBuf, String> {
    if !plain(id) {
        return Err("Odd chat id.".into());
    }
    Ok(chats_dir().join(format!("{id}.json")))
}

pub fn save_chat(mut chat: Chat) -> Result<(), String> {
    let file = chat_file(&chat.id)?;
    std::fs::create_dir_all(chats_dir()).map_err(|e| e.to_string())?;
    chat.title = chat.title.chars().take(80).collect();
    chat.updated = now_ms();
    let json = serde_json::to_vec(&chat).map_err(|e| e.to_string())?;
    std::fs::write(file, json).map_err(|e| format!("Can't save the chat: {e}"))
}

pub fn load_chat(id: &str) -> Result<Chat, String> {
    let bytes = std::fs::read(chat_file(id)?).map_err(|_| "That chat is gone.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "That chat can't be read.".to_string())
}

pub fn delete_chat(id: &str) -> Result<(), String> {
    match std::fs::remove_file(chat_file(id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn clear_chats() -> Result<(), String> {
    for chat in list_chats(0) {
        delete_chat(&chat.id)?;
    }
    Ok(())
}

/// The saved chats, newest first. Ones untouched for `keep_days` are deleted
/// on the way (0 keeps them all).
pub fn list_chats(keep_days: u32) -> Vec<ChatInfo> {
    let Ok(entries) = std::fs::read_dir(chats_dir()) else { return Vec::new() };
    let too_old = (keep_days > 0).then(|| now_ms().saturating_sub(Duration::from_secs(keep_days as u64 * 86_400).as_millis() as u64));
    let mut list: Vec<ChatInfo> = entries
        .flatten()
        .filter_map(|e| {
            let chat: Chat = serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok()?;
            if too_old.is_some_and(|limit| chat.updated < limit) {
                let _ = std::fs::remove_file(e.path());
                return None;
            }
            Some(ChatInfo { id: chat.id, title: chat.title, updated: chat.updated })
        })
        .collect();
    list.sort_by(|a, b| b.updated.cmp(&a.updated));
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_are_cut_out() {
        let (text, notes) = notes("EGP it is!\n⟦remember: prefers prices in EGP⟧\n⟦remember:  on the  Platform team ⟧ ⟦used: 2, 3⟧");
        assert_eq!(text, "EGP it is!");
        assert_eq!(notes.remember, vec!["prefers prices in EGP", "on the Platform team"]);
        assert_eq!(notes.used, vec![2, 3]);
    }

    #[test]
    fn plain_replies_pass_through() {
        let (text, notes) = notes("Hello there.");
        assert_eq!(text, "Hello there.");
        assert_eq!(notes, Notes::default());
        // A note cut off mid-way never shows.
        assert_eq!(super::notes("Sure. ⟦remember: hal").0, "Sure.");
    }

    #[test]
    fn memories_read_as_a_numbered_list() {
        let list = vec![
            Memory { id: "a".into(), text: "prefers EGP".into(), at: 0 },
            Memory { id: "b".into(), text: "uses metric".into(), at: 0 },
        ];
        let text = for_model(&list);
        assert!(text.contains("1. prefers EGP\n2. uses metric"));
        assert_eq!(for_model(&[]), "");
    }

    #[test]
    fn chat_ids_stay_plain() {
        assert!(chat_file("c-mf3k2").is_ok());
        assert!(chat_file("../settings").is_err());
        assert!(chat_file("").is_err());
    }
}
