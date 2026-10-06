// Claude Code sessions. Claude Code posts its hook events (`"type": "http"`
// hooks) to a tiny listener on 127.0.0.1, and the island shows what each
// session is doing. Also installs and removes those hooks in the user's
// ~/.claude/settings.json. Nothing here talks to anything off this machine.
//
// The listener only answers POST /hook carrying Tute's own token header. A web
// page can't add that header without a CORS preflight, which is refused, and
// any request with an Origin header is refused outright — so no website can
// fake a session. The one exception is Tute's browser extension (browser.rs):
// its /browser/* requests carry the token and a chrome-extension:// origin,
// which a website can't claim.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{island, log, settings};

pub const PORT: u16 = 47823;
/// Reports only: answered at once with `{}`.
const HOOK_PATH: &str = "/hook";
/// Questions and permission prompts: held open until the island answers.
const ASK_PATH: &str = "/ask";
const TOKEN_HEADER: &str = "x-tute-token";
/// Tool payloads can be large (a whole file being written); anything bigger is refused.
const MAX_BODY: usize = 8 * 1024 * 1024;
/// How long an ask waits for the island before Claude Code shows its own
/// dialog instead. Just under the hook's `timeout`, so Tute answers first.
const ASK_WAIT: Duration = Duration::from_secs(290);
const ASK_HOOK_TIMEOUT: u32 = 300;

/// Tute's hooks, in the order they appear in settings.json:
/// (event, matcher, path, timeout in seconds).
const HOOKS: &[(&str, Option<&str>, &str, u32)] = &[
    ("SessionStart", None, HOOK_PATH, 3),
    ("UserPromptSubmit", None, HOOK_PATH, 3),
    ("PreToolUse", None, HOOK_PATH, 3),
    ("PreToolUse", Some("AskUserQuestion"), ASK_PATH, ASK_HOOK_TIMEOUT),
    ("PermissionRequest", None, ASK_PATH, ASK_HOOK_TIMEOUT),
    ("PostToolUse", None, HOOK_PATH, 3),
    ("Notification", None, HOOK_PATH, 3),
    ("Stop", None, HOOK_PATH, 3),
    ("StopFailure", None, HOOK_PATH, 3),
    ("SessionEnd", None, HOOK_PATH, 3),
];

static LISTENING: AtomicBool = AtomicBool::new(false);
static NEXT_ASK: AtomicU64 = AtomicU64::new(1);

fn url(path: &str) -> String {
    format!("http://127.0.0.1:{PORT}{path}")
}

/// Asks waiting for the island, by request id.
fn pending() -> &'static Mutex<HashMap<u64, (Sender<Value>, ClaudeAsk)>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, (Sender<Value>, ClaudeAsk)>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

// ── Token ─────────────────────────────────────────────────────────────────────

fn token_path() -> PathBuf {
    settings::config_dir().join("hook-token")
}

/// The shared secret between Tute and the hooks it installed. Made once, kept
/// in %APPDATA%\Tute\hook-token so installed hooks keep working after a restart.
pub fn token() -> String {
    if let Ok(t) = std::fs::read_to_string(token_path()) {
        let t = t.trim();
        if t.len() >= 32 && t.chars().all(|c| c.is_ascii_hexdigit()) {
            return t.to_string();
        }
    }
    let t = random_hex();
    let _ = std::fs::create_dir_all(settings::config_dir());
    if let Err(err) = std::fs::write(token_path(), &t) {
        log::line(format!("claude: could not save the hook token: {err}"));
    }
    t
}

/// 64 hex characters. `RandomState` is seeded from the OS's random source, so
/// this needs no extra crate.
fn random_hex() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    (0..4u64)
        .map(|i| {
            let mut h = RandomState::new().build_hasher();
            h.write_u64(i);
            h.write_u128(nanos);
            h.write_u32(std::process::id());
            format!("{:016x}", h.finish())
        })
        .collect()
}

// ── Listener ──────────────────────────────────────────────────────────────────

/// What the island gets for each hook: only the few fields it shows, never the
/// whole payload (tool results can be megabytes).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEvent {
    event: String,
    session_id: String,
    cwd: String,
    tool: Option<String>,
    /// The tool's target: a file name, a command, a pattern, a URL.
    detail: Option<String>,
    /// notification_type, SessionStart source, SessionEnd reason, error type.
    kind: Option<String>,
    /// The prompt, the notification message, Claude's last reply, an error.
    text: Option<String>,
}

/// Blocks on `accept` in its own thread, so an idle listener costs nothing.
pub fn spawn_listener(app: AppHandle) {
    let token = token();
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(err) => {
                log::line(format!("claude: can't listen on 127.0.0.1:{PORT}: {err}"));
                return;
            }
        };
        LISTENING.store(true, Ordering::Relaxed);
        log::line(format!("claude: listening on 127.0.0.1:{PORT}"));
        refresh_hooks();
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                if let Err(err) = handle(stream, &app, &token) {
                    log::line(format!("claude: {err}"));
                }
            });
        }
    });
}

/// `{}` = no decision: Claude Code carries on exactly as without the hook.
fn respond(stream: &TcpStream, status: &str) {
    respond_json(stream, status, "{}");
}

fn respond_json(mut stream: &TcpStream, status: &str, body: &str) {
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
}

/// Nothing to say (the extension's "no work right now").
fn respond_empty(mut stream: &TcpStream) {
    let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
}

fn respond_html(mut stream: &TcpStream, body: &str) {
    let reply = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
}

/// Claude Code hung up (the turn was interrupted, the session closed).
fn peer_gone(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let mut byte = [0u8; 1];
    let gone = match stream.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) => e.kind() != ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    gone
}

fn handle(stream: TcpStream, app: &AppHandle, token: &str) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let limited = stream.try_clone().map_err(|e| e.to_string())?.take((MAX_BODY + 64 * 1024) as u64);
    let mut reader = BufReader::new(limited);

    let mut request = String::new();
    reader.read_line(&mut request).map_err(|e| e.to_string())?;
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let (mut len, mut token_ok) = (0usize, false);
    let mut origin: Option<String> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim();
            match key.trim().to_ascii_lowercase().as_str() {
                "content-length" => len = value.parse().unwrap_or(usize::MAX),
                TOKEN_HEADER => token_ok = value == token,
                "origin" => origin = Some(value.to_string()),
                _ => {}
            }
        }
    }

    // The browser coming back from Linear's consent page (linear.rs). No token
    // header here — a browser can't send one; the OAuth `state` guards it.
    if method == "GET" {
        if let Some(query) = path.strip_prefix(crate::linear::CALLBACK_PATH).and_then(|r| {
            if r.is_empty() { Some("") } else { r.strip_prefix('?') }
        }) {
            let page = crate::linear::callback(app, query);
            respond_html(&stream, &page);
            return Ok(());
        }
    }

    // Tute's browser extension (browser.rs). Its requests come from a
    // chrome-extension:// origin, which no website can claim, and carry the token.
    let from_extension = origin.as_deref().is_some_and(|o| o.starts_with("chrome-extension://"));
    if token_ok && (origin.is_none() || from_extension) {
        if method == "GET" && path == crate::browser::NEXT_PATH {
            match crate::browser::next_command() {
                Some(command) => respond_json(&stream, "200 OK", &command.to_string()),
                None => respond_empty(&stream),
            }
            return Ok(());
        }
        if method == "POST" && path == crate::browser::RESULT_PATH && len <= MAX_BODY {
            let mut body = vec![0u8; len];
            reader.read_exact(&mut body).map_err(|e| e.to_string())?;
            if let Ok(result) = serde_json::from_slice::<Value>(&body) {
                crate::browser::deliver(&result);
            }
            respond(&stream, "200 OK");
            return Ok(());
        }
    }

    let known_path = path == HOOK_PATH || path == ASK_PATH;
    if method != "POST" || !known_path || !token_ok || origin.is_some() || len > MAX_BODY {
        respond(&stream, "403 Forbidden");
        return Err(format!("refused {method} {path}"));
    }

    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            respond(&stream, "200 OK");
            return Err(format!("bad hook JSON: {e}"));
        }
    };

    if path == ASK_PATH {
        ask(&stream, app, &payload);
        return Ok(());
    }
    respond(&stream, "200 OK");
    if let Some(event) = summarize(&payload) {
        let _ = app.emit_to(island::WINDOW_LABEL, "claude-event", event);
    }
    Ok(())
}

// ── Asks: questions and permission prompts answered on the island ─────────────

/// A question or permission prompt for the island to answer.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAsk {
    request_id: u64,
    /// "question" (AskUserQuestion) or "permission".
    kind: &'static str,
    session_id: String,
    cwd: String,
    tool: Option<String>,
    detail: Option<String>,
    /// AskUserQuestion's `questions`, passed through as Claude wrote them.
    questions: Option<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskClosed {
    request_id: u64,
}

fn build_ask(p: &Value) -> Option<ClaudeAsk> {
    let event = str_field(p, "hook_event_name")?;
    let tool = str_field(p, "tool_name").map(str::to_string);
    let input = p.get("tool_input");
    let kind = match (event, tool.as_deref()) {
        ("PreToolUse", Some("AskUserQuestion")) => "question",
        // Answering AskUserQuestion is done above; never ask "allow it?" about it.
        ("PermissionRequest", Some("AskUserQuestion")) => return None,
        ("PermissionRequest", Some(_)) => "permission",
        _ => return None,
    };
    let questions = if kind == "question" {
        let q = input?.get("questions")?;
        if !q.as_array().is_some_and(|a| !a.is_empty()) {
            return None;
        }
        Some(q.clone())
    } else {
        None
    };
    let detail = input.and_then(|i| {
        str_field(i, "command").map(|c| shorten(c, 160)).or_else(|| tool_detail(i))
    });
    Some(ClaudeAsk {
        request_id: NEXT_ASK.fetch_add(1, Ordering::Relaxed),
        kind,
        session_id: str_field(p, "session_id")?.to_string(),
        cwd: str_field(p, "cwd").unwrap_or("").to_string(),
        tool,
        detail,
        questions,
    })
}

/// The hook's answer for what the island sent back, or None to let Claude
/// Code ask in the terminal as usual.
fn decision(kind: &str, payload: &Value, reply: &Value) -> Option<Value> {
    match kind {
        "question" => {
            let answers = reply.get("answers").filter(|a| a.as_object().is_some_and(|o| !o.is_empty()))?;
            let mut input = payload.get("tool_input").cloned().unwrap_or_else(|| json!({}));
            input.as_object_mut()?.insert("answers".into(), answers.clone());
            Some(json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": "Answered on the Tute island",
                    "updatedInput": input,
                }
            }))
        }
        "permission" => {
            let behavior = reply.get("decision").and_then(Value::as_str)?;
            let decision = match behavior {
                "allow" => json!({ "behavior": "allow" }),
                "deny" => json!({ "behavior": "deny", "message": "Denied from the Tute island" }),
                _ => return None,
            };
            Some(json!({
                "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision }
            }))
        }
        _ => None,
    }
}

/// Holds the hook's request open until the island answers, the wait runs out,
/// or Claude Code hangs up. Anything but an answer replies `{}`, and Claude
/// Code then asks in the terminal exactly as it would without Tute.
fn ask(stream: &TcpStream, app: &AppHandle, payload: &Value) {
    let Some(ask) = build_ask(payload) else {
        respond(stream, "200 OK");
        return;
    };
    let id = ask.request_id;
    let kind = ask.kind;
    let (tx, rx) = mpsc::channel::<Value>();
    pending().lock().unwrap().insert(id, (tx, ask.clone()));
    let _ = app.emit_to(island::WINDOW_LABEL, "claude-ask", ask);

    let deadline = Instant::now() + ASK_WAIT;
    let reply = loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(v) => break Some(v),
            Err(RecvTimeoutError::Timeout) if Instant::now() < deadline && !peer_gone(stream) => {}
            Err(_) => break None,
        }
    };
    pending().lock().unwrap().remove(&id);

    let body = reply.as_ref().and_then(|r| decision(kind, payload, r));
    respond_json(stream, "200 OK", &body.as_ref().map_or_else(|| "{}".to_string(), Value::to_string));
    match (&reply, &body) {
        (None, _) => {
            // Timed out or hung up: take the card down, the terminal has it now.
            let _ = app.emit_to(island::WINDOW_LABEL, "claude-ask-closed", AskClosed { request_id: id });
            log::line(format!("claude: {kind} #{id} went back to the terminal"));
        }
        (Some(_), Some(_)) => log::line(format!("claude: {kind} #{id} answered on the island")),
        (Some(_), None) => log::line(format!("claude: {kind} #{id} handed to the terminal")),
    }
}

/// The island's answer to ask `request_id`. Null hands it to the terminal.
pub fn reply(request_id: u64, reply: Value) {
    if let Some((tx, _)) = pending().lock().unwrap().remove(&request_id) {
        let _ = tx.send(reply);
    }
}

/// Asks still waiting, oldest first: a reloaded island picks them back up.
pub fn waiting() -> Vec<ClaudeAsk> {
    let mut asks: Vec<ClaudeAsk> = pending().lock().unwrap().values().map(|(_, a)| a.clone()).collect();
    asks.sort_by_key(|a| a.request_id);
    asks
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}

/// One line, at most `max` characters.
fn shorten(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let cut: String = flat.chars().take(max - 1).collect();
    format!("{}…", cut.trim_end())
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(path)
}

/// The part of a tool call worth showing: which file, which command, what search.
fn tool_detail(input: &Value) -> Option<String> {
    for key in ["file_path", "notebook_path", "path"] {
        if let Some(p) = str_field(input, key) {
            return Some(file_name(p).to_string());
        }
    }
    for key in ["command", "pattern", "query", "url", "description", "skill", "prompt"] {
        if let Some(s) = str_field(input, key) {
            return Some(shorten(s, 60));
        }
    }
    None
}

fn summarize(p: &Value) -> Option<ClaudeEvent> {
    let event = str_field(p, "hook_event_name")?.to_string();
    let session_id = str_field(p, "session_id")?.to_string();
    let mut out = ClaudeEvent {
        event: event.clone(),
        session_id,
        cwd: str_field(p, "cwd").unwrap_or("").to_string(),
        tool: None,
        detail: None,
        kind: None,
        text: None,
    };
    match event.as_str() {
        "SessionStart" => out.kind = str_field(p, "source").map(str::to_string),
        "SessionEnd" => out.kind = str_field(p, "reason").map(str::to_string),
        "UserPromptSubmit" => out.text = str_field(p, "prompt").map(|s| shorten(s, 120)),
        "PreToolUse" | "PostToolUse" => {
            out.tool = str_field(p, "tool_name").map(str::to_string);
            out.detail = p.get("tool_input").and_then(tool_detail);
        }
        "Notification" => {
            out.kind = str_field(p, "notification_type").map(str::to_string);
            out.text = str_field(p, "message").map(|s| shorten(s, 140));
        }
        // Long enough to post as the Linear comment of "Do it with Claude";
        // the island itself shows only the first two lines.
        "Stop" => out.text = str_field(p, "last_assistant_message").map(|s| s.chars().take(4000).collect()),
        "StopFailure" => {
            let err = p.get("error");
            out.kind = str_field(p, "error_type")
                .or_else(|| err.and_then(|e| str_field(e, "type")))
                .map(str::to_string);
            out.text = str_field(p, "error_message")
                .or_else(|| err.and_then(|e| str_field(e, "message")))
                .or_else(|| err.and_then(Value::as_str))
                .or_else(|| str_field(p, "last_assistant_message"))
                .map(|s| shorten(s, 160));
        }
        _ => return None,
    }
    Some(out)
}

// ── Hooks in ~/.claude/settings.json ──────────────────────────────────────────

fn claude_settings_path() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Ok(PathBuf::from(dir).join("settings.json"));
    }
    let home = std::env::var_os("USERPROFILE").ok_or("Can't find your user folder.")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn is_ours(hook: &Value) -> bool {
    let prefix = format!("http://127.0.0.1:{PORT}/");
    hook.get("url").and_then(Value::as_str).is_some_and(|u| u.starts_with(&prefix))
}

/// The settings.json group for one entry of HOOKS.
fn hook_group(matcher: Option<&str>, path: &str, timeout: u32, token: &str) -> Value {
    let hook = json!({
        "type": "http",
        "url": url(path),
        "headers": { "X-Tute-Token": token },
        "timeout": timeout,
    });
    match matcher {
        Some(m) => json!({ "matcher": m, "hooks": [hook] }),
        None => json!({ "hooks": [hook] }),
    }
}

/// The file as JSON. A file that isn't valid JSON is never overwritten.
fn read_claude_settings(path: &PathBuf) -> Result<Value, String> {
    let root = match std::fs::read_to_string(path) {
        Ok(s) if s.trim().is_empty() => json!({}),
        Ok(s) => serde_json::from_str(&s).map_err(|e| {
            format!("{} isn't valid JSON ({e}), so Tute left it alone.", path.display())
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("Can't read {}: {e}", path.display())),
    };
    if !root.is_object() {
        return Err(format!("{} isn't a JSON object, so Tute left it alone.", path.display()));
    }
    Ok(root)
}

/// Drops Tute's hooks and any group or event left empty by that. Leaves every
/// other hook exactly as it was.
fn strip_ours(root: &mut Value) {
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else { return };
    for groups in hooks.values_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        for group in groups.iter_mut() {
            if let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                list.retain(|h| !is_ours(h));
            }
        }
        groups.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|l| !l.is_empty()));
    }
    hooks.retain(|_, groups| groups.as_array().is_none_or(|a| !a.is_empty()));
    if hooks.is_empty() {
        root.as_object_mut().map(|o| o.remove("hooks"));
    }
}

fn write_claude_settings(path: &PathBuf, root: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // One backup of the user's file as it was before Tute ever touched it.
    let backup = path.with_extension("json.tute-backup");
    if path.exists() && !backup.exists() {
        let _ = std::fs::copy(path, &backup);
    }
    let mut text = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    text.push('\n');
    let tmp = path.with_extension("json.tute-tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("Can't write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Can't update {}: {e}", path.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    /// Every event Tute needs has its hook in settings.json.
    installed: bool,
    /// The listener is up (false: another program holds the port).
    listening: bool,
    port: u16,
    settings_path: String,
}

pub fn status() -> HooksStatus {
    let path = claude_settings_path().unwrap_or_default();
    // Every hook in HOOKS, at its own path: an install from before a new hook
    // was added reads as "not connected", and Connect brings it up to date.
    let installed = read_claude_settings(&path).is_ok_and(|root| {
        HOOKS.iter().all(|(ev, _, hook_path, _)| {
            let want = url(hook_path);
            root.pointer(&format!("/hooks/{ev}"))
                .and_then(Value::as_array)
                .is_some_and(|groups| {
                    groups.iter().any(|g| {
                        g.get("hooks").and_then(Value::as_array).is_some_and(|l| {
                            l.iter().any(|h| h.get("url").and_then(Value::as_str) == Some(want.as_str()))
                        })
                    })
                })
        })
    });
    HooksStatus {
        installed,
        listening: LISTENING.load(Ordering::Relaxed),
        port: PORT,
        settings_path: path.display().to_string(),
    }
}

pub fn install() -> Result<(), String> {
    let path = claude_settings_path()?;
    let mut root = read_claude_settings(&path)?;
    strip_ours(&mut root);
    let token = token();
    let obj = root.as_object_mut().ok_or("settings.json isn't an object")?;
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" in settings.json isn't an object")?;
    for (ev, matcher, path, timeout) in HOOKS {
        let groups = hooks.entry(*ev).or_insert_with(|| json!([]));
        let groups = groups.as_array_mut().ok_or_else(|| format!("\"hooks.{ev}\" isn't a list"))?;
        groups.push(hook_group(*matcher, path, *timeout, &token));
    }
    write_claude_settings(&path, &root)?;
    log::line(format!("claude: hooks installed in {}", path.display()));
    Ok(())
}

/// Someone who connected an older Tute gets the hooks added since (questions,
/// permission prompts) without having to press Connect again. Never installs
/// anything for someone who hasn't connected.
fn refresh_hooks() {
    let Ok(path) = claude_settings_path() else { return };
    let Ok(root) = read_claude_settings(&path) else { return };
    let connected = root
        .get("hooks")
        .and_then(Value::as_object)
        .is_some_and(|hooks| {
            hooks.values().filter_map(Value::as_array).flatten().any(|g| {
                g.get("hooks").and_then(Value::as_array).is_some_and(|l| l.iter().any(is_ours))
            })
        });
    if connected && !status().installed {
        if let Err(err) = install() {
            log::line(format!("claude: could not update the hooks: {err}"));
        }
    }
}

pub fn remove() -> Result<(), String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok(());
    }
    let mut root = read_claude_settings(&path)?;
    strip_ours(&mut root);
    write_claude_settings(&path, &root)?;
    log::line(format!("claude: hooks removed from {}", path.display()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ours() -> Value {
        json!({ "type": "http", "url": url(HOOK_PATH), "headers": { "X-Tute-Token": "x" } })
    }

    #[test]
    fn strip_keeps_other_hooks() {
        let mut root = json!({
            "model": "opus",
            "hooks": {
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "say done" }, ours()] },
                    { "hooks": [ours()] }
                ],
                "SessionEnd": [{ "hooks": [ours()] }]
            }
        });
        strip_ours(&mut root);
        assert_eq!(
            root,
            json!({
                "model": "opus",
                "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }] }
            })
        );
    }

    #[test]
    fn strip_removes_empty_hooks_key() {
        let mut root = json!({ "hooks": { "Stop": [{ "hooks": [ours()] }] } });
        strip_ours(&mut root);
        assert_eq!(root, json!({}));
    }

    #[test]
    fn summarize_tool_shows_file_name_only() {
        let e = summarize(&json!({
            "hook_event_name": "PreToolUse", "session_id": "s", "cwd": r"E:\tute",
            "tool_name": "Edit", "tool_input": { "file_path": r"E:\tute\src\island\island.ts", "old_string": "a" }
        }))
        .unwrap();
        assert_eq!(e.tool.as_deref(), Some("Edit"));
        assert_eq!(e.detail.as_deref(), Some("island.ts"));
    }

    #[test]
    fn summarize_ignores_unknown_events_and_trims_text() {
        assert!(summarize(&json!({ "hook_event_name": "FileChanged", "session_id": "s" })).is_none());
        // Stop keeps the whole summary (it becomes a Linear comment), up to a cap.
        let long = "word ".repeat(2000);
        let e = summarize(&json!({ "hook_event_name": "Stop", "session_id": "s", "last_assistant_message": long })).unwrap();
        assert_eq!(e.text.unwrap().chars().count(), 4000);
    }
}

#[cfg(test)]
mod ask_tests {
    use super::*;

    fn question_payload() -> Value {
        json!({
            "hook_event_name": "PreToolUse", "session_id": "s", "cwd": "E:/tute",
            "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{
                "question": "Which slime?", "header": "Shape", "multiSelect": false,
                "options": [{ "label": "Drippy", "description": "d" }, { "label": "Dome", "description": "c" }]
            }] }
        })
    }

    #[test]
    fn question_answer_passes_questions_through_and_adds_answers() {
        let p = question_payload();
        let ask = build_ask(&p).unwrap();
        assert_eq!(ask.kind, "question");
        let out = decision("question", &p, &json!({ "answers": { "Which slime?": "Drippy" } })).unwrap();
        let o = &out["hookSpecificOutput"];
        assert_eq!(o["hookEventName"], "PreToolUse");
        assert_eq!(o["permissionDecision"], "allow");
        assert_eq!(o["updatedInput"]["answers"]["Which slime?"], "Drippy");
        assert_eq!(o["updatedInput"]["questions"], p["tool_input"]["questions"]);
    }

    #[test]
    fn terminal_or_empty_reply_gives_no_decision() {
        let p = question_payload();
        assert!(decision("question", &p, &Value::Null).is_none());
        assert!(decision("question", &p, &json!({ "answers": {} })).is_none());
        assert!(decision("permission", &p, &Value::Null).is_none());
    }

    #[test]
    fn permission_allow_and_deny() {
        let p = json!({ "hook_event_name": "PermissionRequest", "session_id": "s",
            "tool_name": "Bash", "tool_input": { "command": "npm test" } });
        let ask = build_ask(&p).unwrap();
        assert_eq!((ask.kind, ask.detail.as_deref()), ("permission", Some("npm test")));
        let allow = decision("permission", &p, &json!({ "decision": "allow" })).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");
        let deny = decision("permission", &p, &json!({ "decision": "deny" })).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
    }

    #[test]
    fn never_asks_permission_for_ask_user_question() {
        let p = json!({ "hook_event_name": "PermissionRequest", "session_id": "s", "tool_name": "AskUserQuestion" });
        assert!(build_ask(&p).is_none());
    }
}
