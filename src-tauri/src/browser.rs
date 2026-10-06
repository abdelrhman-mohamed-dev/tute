// The link to Tute's browser extension (extension/ in the repo). The
// extension asks the local listener for work (GET /browser/next, held open
// until there's a command) and posts back what happened (POST
// /browser/result). Both carry Tute's token; see claude.rs for the listener.
//
// Tute writes the extension into %LOCALAPPDATA%\Tute\extension with its port
// and token in config.js, so loading it unpacked is the only setup.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};

pub const NEXT_PATH: &str = "/browser/next";
pub const RESULT_PATH: &str = "/browser/result";

/// The extension counts as connected if it asked for work this recently.
const SEEN_WITHIN_S: u64 = 45;
/// How long the extension's request is held when there's nothing to do.
const HOLD: Duration = Duration::from_secs(20);

struct Hub {
    queue: Mutex<VecDeque<Value>>,
    ready: Condvar,
    waiting: Mutex<HashMap<u64, Sender<Result<Value, String>>>>,
    last_seen: AtomicU64,
    next_id: AtomicU64,
}

fn hub() -> &'static Hub {
    static HUB: OnceLock<Hub> = OnceLock::new();
    HUB.get_or_init(|| Hub {
        queue: Mutex::new(VecDeque::new()),
        ready: Condvar::new(),
        waiting: Mutex::new(HashMap::new()),
        last_seen: AtomicU64::new(0),
        next_id: AtomicU64::new(1),
    })
}

fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn connected() -> bool {
    now_s().saturating_sub(hub().last_seen.load(Ordering::Relaxed)) <= SEEN_WITHIN_S
}

/// The extension asks for work: the next command, or None after a while.
pub fn next_command() -> Option<Value> {
    let hub = hub();
    hub.last_seen.store(now_s(), Ordering::Relaxed);
    let queue = hub.queue.lock().unwrap();
    let (mut queue, _) = hub.ready.wait_timeout_while(queue, HOLD, |q| q.is_empty()).unwrap();
    hub.last_seen.store(now_s(), Ordering::Relaxed);
    queue.pop_front()
}

/// The extension reports back: `{ id, ok, data | error }`.
pub fn deliver(result: &Value) {
    let Some(id) = result["id"].as_u64() else { return };
    let Some(waiter) = hub().waiting.lock().unwrap().remove(&id) else { return };
    let answer = if result["ok"].as_bool() == Some(true) {
        Ok(result["data"].clone())
    } else {
        Err(result["error"].as_str().unwrap_or("The browser couldn't do that.").to_string())
    };
    let _ = waiter.send(answer);
}

/// Sends a command to the extension and waits (off the async runtime) for its answer.
pub async fn command(kind: &str, mut args: Value, timeout: Duration) -> Result<Value, String> {
    if !connected() {
        return Err("The Tute extension isn't connected. Set it up in Settings → Connections, with your browser open.".into());
    }
    let hub = hub();
    let id = hub.next_id.fetch_add(1, Ordering::Relaxed);
    args["id"] = json!(id);
    args["kind"] = json!(kind);
    let (tx, rx) = mpsc::channel();
    hub.waiting.lock().unwrap().insert(id, tx);
    hub.queue.lock().unwrap().push_back(args);
    hub.ready.notify_all();
    let answer = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(timeout))
        .await
        .map_err(|e| e.to_string())?;
    hub.waiting.lock().unwrap().remove(&id);
    answer.unwrap_or_else(|_| Err("The browser took too long to answer.".into()))
}

// ── Setting the extension up ──────────────────────────────────────────────────

const MANIFEST: &str = include_str!("../../extension/manifest.json");
const BACKGROUND: &str = include_str!("../../extension/background.js");
const ICON: &[u8] = include_bytes!("../icons/128x128.png");

pub fn folder() -> PathBuf {
    crate::settings::local_dir().join("extension")
}

/// Writes the extension (with this PC's port and token) and returns its folder.
pub fn install() -> Result<PathBuf, String> {
    let dir = folder();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't make the extension folder: {e}"))?;
    let config = format!(
        "// Written by Tute: how to reach Tute on this PC.\nconst TUTE = {};\n",
        json!({ "port": crate::claude::PORT, "token": crate::claude::token() })
    );
    for (name, bytes) in [
        ("manifest.json", MANIFEST.as_bytes()),
        ("background.js", BACKGROUND.as_bytes()),
        ("config.js", config.as_bytes()),
        ("icon.png", ICON),
    ] {
        std::fs::write(dir.join(name), bytes).map_err(|e| format!("Can't write {name}: {e}"))?;
    }
    Ok(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub connected: bool,
    /// The extension's folder, once it has been written.
    pub folder: Option<String>,
}

pub fn status() -> BrowserStatus {
    let dir = folder();
    BrowserStatus {
        connected: connected(),
        folder: dir.join("manifest.json").is_file().then(|| dir.to_string_lossy().into_owned()),
    }
}
