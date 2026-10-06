// Tute's settings: plain JSON at %APPDATA%\Tute\settings.json, written by the
// pages through `save_settings`. The field names are what's on people's disks:
// rename one and that setting is lost. Unknown fields are ignored and missing
// ones take their default, so old and new files both load.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    /// Seconds after the mouse leaves before the open island folds to the bar.
    pub auto_close_interval: f64,
    /// Which display: "primary", "cursor" (wherever the mouse is) or
    /// "monitor:<device name>" (one display; the main one while it's unplugged).
    pub screen: String,
    pub autostart: bool,
    /// Off: the bar always stays at the top. On: it hides when nothing's going on.
    pub hide_when_idle: bool,
    /// "tute" or "tutee"; none until it's picked on first launch.
    pub personality: Option<String>,
    /// The AI providers added in Settings. Their keys are in the Credential
    /// Manager (secrets.rs), never here.
    pub providers: Vec<Provider>,
    /// The model the chat uses.
    pub active_model: Option<ActiveModel>,
    /// The Linear team new issues go to (the last one picked).
    pub linear_team: Option<String>,
    /// How the chat talks: "fun" or "focus".
    pub chat_mode: String,
    /// "Do it with Claude": the folder Claude works in, per Linear team.
    pub claude_folders: HashMap<String, String>,
    /// When Claude finishes an issue: post its summary, move it to review.
    pub claude_done_comment: bool,
    pub claude_done_review: bool,
    /// The chat remembers lasting things you tell it (memory.rs).
    pub memory_on: bool,
    /// Saved chats untouched this many days are deleted; 0 keeps them all.
    pub chat_keep_days: u32,
    /// The Obsidian vault Tute writes to (its folder), once one is chosen.
    pub obsidian_vault: Option<String>,
    /// The bond (points, level, what it wears). The island owns its shape
    /// (src/island/bond.ts); here it's only kept.
    pub bond: Option<serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            screen: "primary".into(),
            autostart: false,
            hide_when_idle: false,
            personality: None,
            providers: Vec::new(),
            active_model: None,
            linear_team: None,
            chat_mode: "fun".into(),
            claude_folders: HashMap::new(),
            claude_done_comment: true,
            claude_done_review: true,
            memory_on: true,
            chat_keep_days: 30,
            obsidian_vault: None,
            bond: None,
        }
    }
}

/// How a provider is spoken to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    /// OpenAI's Chat Completions, which most providers speak: OpenAI, GLM,
    /// DeepSeek, OpenRouter, Groq, Ollama, LM Studio…
    OpenAi,
    /// Anthropic's Messages API (Claude).
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    /// Made by the settings page; it also names the provider's key (secrets.rs).
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    /// The API's root, like `https://api.openai.com/v1`.
    pub base_url: String,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveModel {
    pub provider_id: String,
    pub model: String,
}

/// `%<var>%\Tute`, or `.\Tute` if Windows doesn't say.
fn app_folder(var: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| ".".into()).join("Tute")
}

/// %APPDATA%\Tute: the settings, and the Claude hooks' token.
pub fn config_dir() -> PathBuf {
    app_folder("APPDATA")
}

/// %LOCALAPPDATA%\Tute: the log, the inbox, Claude's task files.
pub fn local_dir() -> PathBuf {
    app_folder("LOCALAPPDATA")
}

fn file() -> PathBuf {
    config_dir().join("settings.json")
}

/// The saved settings; the defaults if there are none or they can't be read.
pub fn load() -> Settings {
    std::fs::read(file()).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir())?;
    let json = serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?;
    std::fs::write(file(), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_files_still_load() {
        // A file from an older version: an unknown field, most fields missing.
        let s: Settings = serde_json::from_str(r#"{"soundEnabled":false,"absenceInterval":180,"screen":"cursor"}"#).unwrap();
        assert!(!s.sound_enabled);
        assert_eq!(s.screen, "cursor");
        assert_eq!(s.chat_mode, "fun");
        assert!(s.claude_done_review);
    }

    #[test]
    fn names_on_disk_are_camel_case() {
        let json = serde_json::to_string(&Settings::default()).unwrap();
        for name in ["soundEnabled", "autoCloseInterval", "hideWhenIdle", "activeModel", "claudeFolders", "claudeDoneComment"] {
            assert!(json.contains(name), "{name} missing from {json}");
        }
    }
}
