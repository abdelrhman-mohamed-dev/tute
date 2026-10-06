// Linear, connected the way Claude connects to it: through Linear's hosted MCP
// server. Every Tute install registers itself with Linear on the first Connect
// (OAuth dynamic client registration), so there is no app to set up and no
// client id or secret in this open-source code. Then:
//   1. Linear's consent page opens in the browser (OAuth 2.1 + PKCE),
//   2. the browser comes back to Tute's loopback listener (claude.rs,
//      GET /linear/callback),
//   3. the tokens go into the Windows Credential Manager,
//   4. Tute calls Linear's MCP tools with them (`call_tool`).
//
// Nothing here runs until the user presses Connect, and the only host it talks
// to is mcp.linear.app.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use windows::Win32::Security::Cryptography::{
    BCryptGenRandom, BCryptHash, BCRYPT_SHA256_ALG_HANDLE, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
};

use crate::{claude, log, secrets};

/// Linear's MCP server, and where it says its OAuth endpoints are.
const MCP_URL: &str = "https://mcp.linear.app/mcp";
const AUTH_METADATA_URL: &str = "https://mcp.linear.app/.well-known/oauth-authorization-server";
const SCOPES: &str = "read write";
const MCP_PROTOCOL: &str = "2025-06-18";
pub const CALLBACK_PATH: &str = "/linear/callback";
/// Credential Manager entry: `service:linear`.
const SECRET: &str = "linear";
/// A Connect that isn't finished in the browser within this long is dropped.
const SIGN_IN_WINDOW: Duration = Duration::from_secs(10 * 60);

fn redirect_uri() -> String {
    format!("http://127.0.0.1:{}{CALLBACK_PATH}", claude::PORT)
}

// ── Randomness, SHA-256, base64url (Windows CNG — no extra crates) ────────────

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut buf = [0u8; N];
    unsafe { BCryptGenRandom(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }
        .ok()
        .map_err(|e| format!("no randomness: {e}"))?;
    Ok(buf)
}

fn sha256(data: &[u8]) -> Result<[u8; 32], String> {
    let mut out = [0u8; 32];
    unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, data, &mut out) }
        .ok()
        .map_err(|e| format!("sha256 failed: {e}"))?;
    Ok(out)
}

/// RFC 4648 base64url without padding, as PKCE wants it.
fn base64url(data: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(data.len() * 4 / 3 + 3);
    for chunk in data.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..=chunk.len() {
            out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// `a=1&b=2`, form-encoded, using the URL parser reqwest already brings.
fn form(pairs: &[(&str, &str)]) -> String {
    let mut url = reqwest::Url::parse("http://x/").expect("static url");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or("").to_string()
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())
}

fn short(body: &str) -> String {
    body.chars().take(200).collect()
}

// ── Stored connection ─────────────────────────────────────────────────────────

/// What sits in the Credential Manager. Never sent to the front end.
#[derive(Clone, Serialize, Deserialize)]
struct Tokens {
    /// This install's own registration with Linear.
    client_id: String,
    token_endpoint: String,
    revocation_endpoint: Option<String>,
    access_token: String,
    refresh_token: Option<String>,
    /// Unix seconds.
    expires_at: u64,
    /// Who connected, for the settings page and the home screen.
    user: Option<String>,
}

fn load() -> Option<Tokens> {
    serde_json::from_str(&secrets::read(secrets::Slot::Login(SECRET))?).ok()
}

fn store(t: &Tokens) -> Result<(), String> {
    secrets::write(secrets::Slot::Login(SECRET), &serde_json::to_string(t).map_err(|e| e.to_string())?)
}

/// What the front end may know: whether, and as whom.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearStatus {
    connected: bool,
    /// A Connect is waiting for the browser.
    signing_in: bool,
    user: Option<String>,
}

pub fn status() -> LinearStatus {
    let t = load();
    LinearStatus {
        connected: t.is_some(),
        signing_in: PENDING.lock().unwrap().as_ref().is_some_and(|p| p.started.elapsed() < SIGN_IN_WINDOW),
        user: t.and_then(|t| t.user),
    }
}

fn announce(app: &AppHandle) {
    let _ = app.emit("linear-changed", status());
}

// ── Connect ───────────────────────────────────────────────────────────────────

struct Pending {
    state: String,
    verifier: String,
    client_id: String,
    token_endpoint: String,
    revocation_endpoint: Option<String>,
    started: Instant,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

#[derive(Deserialize)]
struct AuthMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: String,
    revocation_endpoint: Option<String>,
}

/// Registers this install with Linear (RFC 7591) as a public client: no secret.
async fn register(endpoint: &str) -> Result<String, String> {
    let resp = client()?
        .post(endpoint)
        .json(&json!({
            "client_name": "Tute",
            "redirect_uris": [redirect_uri()],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Linear: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Linear refused to register Tute ({status}): {}", short(&body)));
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| format!("Unexpected reply from Linear: {e}"))?;
    v.get("client_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Linear didn't give Tute a client id.".to_string())
}

/// Starts a Connect: registers this install and returns Linear's consent page URL.
pub async fn begin(app: &AppHandle) -> Result<String, String> {
    let meta: AuthMetadata = client()?
        .get(AUTH_METADATA_URL)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Linear: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Unexpected reply from Linear: {e}"))?;
    let client_id = register(&meta.registration_endpoint).await?;

    let state = base64url(&random_bytes::<24>()?);
    let verifier = base64url(&random_bytes::<48>()?);
    let challenge = base64url(&sha256(verifier.as_bytes())?);
    let url = reqwest::Url::parse_with_params(
        &meta.authorization_endpoint,
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", &redirect_uri()),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("resource", MCP_URL),
        ],
    )
    .map_err(|e| e.to_string())?;
    *PENDING.lock().unwrap() = Some(Pending {
        state,
        verifier,
        client_id,
        token_endpoint: meta.token_endpoint,
        revocation_endpoint: meta.revocation_endpoint,
        started: Instant::now(),
    });
    log::line("linear: registered, waiting for the browser");
    announce(app);
    Ok(url.to_string())
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

async fn token_request(endpoint: &str, pairs: &[(&str, &str)]) -> Result<TokenReply, String> {
    let resp = client()?
        .post(endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form(pairs))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Linear: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Linear said no ({status}): {}", short(&body)));
    }
    serde_json::from_str(&body).map_err(|e| format!("Unexpected reply from Linear: {e}"))
}

/// The browser came back to GET /linear/callback. Returns the page to show
/// in the browser tab. Runs on the listener's own thread.
pub fn callback(app: &AppHandle, query: &str) -> String {
    let params: Vec<(String, String)> = reqwest::Url::parse(&format!("http://x/?{query}"))
        .map(|u| u.query_pairs().into_owned().collect())
        .unwrap_or_default();
    let get = |k: &str| params.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());

    let pending = PENDING.lock().unwrap().take();
    let result = (|| {
        let pending = pending.ok_or("This sign-in wasn't started from Tute, or it already finished.")?;
        if pending.started.elapsed() > SIGN_IN_WINDOW {
            return Err("That sign-in took too long. Press Connect again.".to_string());
        }
        if get("state").as_deref() != Some(pending.state.as_str()) {
            return Err("This sign-in doesn't match the one Tute started.".to_string());
        }
        if let Some(err) = get("error") {
            return Err(match err.as_str() {
                "access_denied" => "You cancelled the connection.".to_string(),
                _ => format!("Linear said: {}", get("error_description").unwrap_or(err)),
            });
        }
        let code = get("code").ok_or("Linear didn't send a code back.")?;
        tauri::async_runtime::block_on(async {
            let reply = token_request(
                &pending.token_endpoint,
                &[
                    ("grant_type", "authorization_code"),
                    ("code", &code),
                    ("redirect_uri", &redirect_uri()),
                    ("client_id", &pending.client_id),
                    ("code_verifier", &pending.verifier),
                    ("resource", MCP_URL),
                ],
            )
            .await?;
            let mut tokens = Tokens {
                client_id: pending.client_id,
                token_endpoint: pending.token_endpoint,
                revocation_endpoint: pending.revocation_endpoint,
                access_token: reply.access_token,
                refresh_token: reply.refresh_token,
                expires_at: now_secs() + reply.expires_in.unwrap_or(3600),
                user: None,
            };
            store(&tokens)?;
            tokens.user = whoami().await;
            store(&tokens)?;
            Ok::<_, String>(tokens)
        })
    })();

    let page = match &result {
        Ok(t) => {
            log::line("linear: connected");
            let who = t.user.as_deref().map(|u| format!("Signed in as {u}. ")).unwrap_or_default();
            callback_page("Tute is connected to Linear", &format!("{who}You can close this tab."), true)
        }
        Err(e) => {
            log::line(format!("linear: connect failed: {e}"));
            callback_page("Couldn't connect Linear", e, false)
        }
    };
    announce(app);
    page
}

/// The connected user's name, from Linear's own tools. Also logs which tools
/// Linear offers, so the next features can be built on what is really there.
async fn whoami() -> Option<String> {
    let mut mcp = Mcp::open().await.map_err(|e| log::line(format!("linear: mcp: {e}"))).ok()?;
    if let Ok(list) = mcp.request("tools/list", json!({})).await {
        let names: Vec<&str> = list
            .get("tools")
            .and_then(Value::as_array)
            .map(|t| t.iter().filter_map(|t| t.get("name").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        log::line(format!("linear: {} tools: {}", names.len(), names.join(", ")));
    }
    let reply = mcp.request("tools/call", json!({ "name": "get_user", "arguments": { "query": "me" } })).await.ok()?;
    let text = reply.pointer("/content/0/text").and_then(Value::as_str)?;
    // The tool answers with JSON text; take the name from it, or give up quietly.
    let user: Value = serde_json::from_str(text).ok()?;
    user.get("displayName")
        .or_else(|| user.get("name"))
        .or_else(|| user.get("email"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The small page the browser shows after Linear sends it back.
fn callback_page(title: &str, detail: &str, ok: bool) -> String {
    let accent = if ok { "#34d399" } else { "#f4505e" };
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>{t}</title>\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>\
         <body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;\
         color:#f5f6f8;font:15px system-ui,'Segoe UI',sans-serif\">\
         <div style=\"text-align:center;padding:32px\">\
         <div style=\"width:14px;height:14px;border-radius:50%;background:{accent};margin:0 auto 18px\"></div>\
         <h1 style=\"font-size:20px;font-weight:600;margin:0 0 8px\">{t}</h1>\
         <p style=\"margin:0;color:#9398a1\">{d}</p></div></body></html>",
        t = escape(title),
        d = escape(detail),
    )
}

// ── Using the connection: Linear's MCP tools ──────────────────────────────────

/// A valid access token, refreshed when it's about to run out.
async fn access_token() -> Result<String, String> {
    let mut t = load().ok_or("Linear isn't connected.")?;
    if t.expires_at > now_secs() + 60 {
        return Ok(t.access_token);
    }
    let refresh = t.refresh_token.clone().ok_or("Linear needs you to connect again.")?;
    let reply = token_request(
        &t.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh),
            ("client_id", &t.client_id),
            ("resource", MCP_URL),
        ],
    )
    .await?;
    t.access_token = reply.access_token;
    if reply.refresh_token.is_some() {
        t.refresh_token = reply.refresh_token;
    }
    t.expires_at = now_secs() + reply.expires_in.unwrap_or(3600);
    store(&t)?;
    Ok(t.access_token)
}

/// One MCP conversation with Linear over Streamable HTTP.
struct Mcp {
    token: String,
    session: Option<String>,
    next_id: u64,
}

impl Mcp {
    async fn open() -> Result<Self, String> {
        let mut mcp = Mcp { token: access_token().await?, session: None, next_id: 1 };
        mcp.request(
            "initialize",
            json!({
                "protocolVersion": MCP_PROTOCOL,
                "capabilities": {},
                "clientInfo": { "name": "tute", "version": env!("CARGO_PKG_VERSION") },
            }),
        )
        .await?;
        mcp.send("notifications/initialized", None, json!({})).await?;
        Ok(mcp)
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let reply = self.send(method, Some(id), params).await?.ok_or("Linear sent no reply.")?;
        if let Some(err) = reply.get("error") {
            let msg = err.get("message").and_then(Value::as_str).unwrap_or("unknown error");
            return Err(format!("Linear: {msg}"));
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Posts one JSON-RPC message; for a request, returns its reply (which may
    /// come as plain JSON or inside a server-sent event stream).
    async fn send(&mut self, method: &str, id: Option<u64>, params: Value) -> Result<Option<Value>, String> {
        let mut body = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        if let Some(id) = id {
            body["id"] = json!(id);
        }
        let mut req = client()?
            .post(MCP_URL)
            .bearer_auth(&self.token)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", MCP_PROTOCOL)
            .json(&body);
        if let Some(s) = &self.session {
            req = req.header("Mcp-Session-Id", s);
        }
        let resp = req.send().await.map_err(|e| format!("Couldn't reach Linear: {e}"))?;
        if let Some(s) = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            self.session = Some(s.to_string());
        }
        let status = resp.status();
        let is_sse = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|c| c.starts_with("text/event-stream"));
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if status.as_u16() == 401 {
            return Err("Linear needs you to connect again.".into());
        }
        if !status.is_success() {
            return Err(format!("Linear said no ({status}): {}", short(&text)));
        }
        let Some(id) = id else { return Ok(None) };
        let messages: Vec<Value> = if is_sse {
            text.lines()
                .filter_map(|l| l.strip_prefix("data:"))
                .filter_map(|d| serde_json::from_str(d.trim()).ok())
                .collect()
        } else {
            serde_json::from_str(&text).map(|v| vec![v]).unwrap_or_default()
        };
        Ok(messages.into_iter().find(|m| m.get("id") == Some(&json!(id))))
    }
}

/// Calls one of Linear's MCP tools and returns what it answered — tools reply
/// with JSON inside a text block; an `isError` reply becomes the error.
async fn call_tool(name: &str, arguments: Value) -> Result<Value, String> {
    let mut mcp = Mcp::open().await?;
    let result = mcp.request("tools/call", json!({ "name": name, "arguments": arguments })).await?;
    let text = result.pointer("/content/0/text").and_then(Value::as_str).unwrap_or("");
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(format!("Linear: {}", short(text)));
    }
    Ok(serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string())))
}

// ── The island's Linear actions ───────────────────────────────────────────────

/// One issue as the island lists it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// The identifier, e.g. DEV-2283.
    id: String,
    title: String,
    url: String,
    /// The team's own name for it ("🔁 Changes Requested").
    status: String,
    /// triage | backlog | unstarted | started | completed | canceled
    status_type: String,
    /// 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    priority: u8,
    team: String,
}

fn issue_from(v: &Value) -> Option<Issue> {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Some(Issue {
        id: v.get("id").and_then(Value::as_str)?.to_string(),
        title: s("title"),
        url: s("url"),
        status: s("status"),
        status_type: s("statusType"),
        priority: v.pointer("/priority/value").and_then(Value::as_u64).unwrap_or(0) as u8,
        team: s("team"),
    })
}

/// Open issues assigned to the user, most recently touched first.
pub async fn my_issues() -> Result<Vec<Issue>, String> {
    let reply = call_tool(
        "list_issues",
        json!({
            "assignee": "me",
            "limit": 50,
            "orderBy": "updatedAt",
            "fields": ["id", "title", "url", "status", "statusType", "priority", "team"],
        }),
    )
    .await?;
    Ok(reply
        .get("issues")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(issue_from).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.status_type != "completed" && i.status_type != "canceled")
        .collect())
}

/// A team's statuses: (id, type, name).
async fn statuses(team: &str) -> Result<Vec<(String, String, String)>, String> {
    let reply = call_tool("list_issue_statuses", json!({ "team": team })).await?;
    let list = reply.as_array().or_else(|| reply.get("statuses").and_then(Value::as_array));
    Ok(list
        .map(|l| {
            l.iter()
                .filter_map(|s| {
                    let f = |k: &str| s.get(k).and_then(Value::as_str).map(str::to_string);
                    Some((f("id")?, f("type")?, f("name")?))
                })
                .collect()
        })
        .unwrap_or_default())
}

/// The status a move should land on. Teams often have several statuses of one
/// type ("🔁 Changes Requested" and "In Progress" are both started), so the
/// usual name wins: In Progress, Done, Review. None when the team has no such
/// status (for "review", nothing to move to).
async fn resolve_state(team: &str, want: &str) -> Result<Option<String>, String> {
    let (kind, prefer): (&str, fn(&str) -> bool) = match want {
        "started" => ("started", |n| n.to_lowercase().contains("progress")),
        "completed" => ("completed", |n| n.trim().eq_ignore_ascii_case("done")),
        "review" => ("started", |n| n.to_lowercase().contains("review")),
        // A status name (Undo puts back exactly what it was).
        other => return Ok(Some(other.to_string())),
    };
    let all = statuses(team).await?;
    let of_kind: Vec<_> = all.iter().filter(|(_, t, _)| t == kind).collect();
    let chosen = of_kind.iter().find(|(_, _, n)| prefer(n)).or(if want == "review" { None } else { of_kind.first() });
    Ok(chosen.map(|(id, _, _)| id.clone()))
}

/// Moves an issue: `state` is "started", "completed", "review" or a status
/// name (for Undo, the one it had before). `team` picks the right status.
pub async fn set_state(id: &str, state: &str, team: &str) -> Result<(), String> {
    let target = if team.is_empty() { Some(state.to_string()) } else { resolve_state(team, state).await? };
    let Some(target) = target else { return Ok(()) };
    call_tool("save_issue", json!({ "id": id, "state": target })).await.map(|_| ())
}

/// Title, link and description, for the task Claude is given.
pub async fn issue_brief(id: &str) -> Result<(String, String, String), String> {
    let v = call_tool("get_issue", json!({ "id": id })).await?;
    let issue = v.get("issue").unwrap_or(&v);
    let s = |k: &str| issue.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Ok((s("title"), s("url"), s("description")))
}

/// What "when done" managed to do.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    commented: bool,
    /// The status it was moved to, if any.
    moved_to: Option<String>,
}

/// Claude finished an issue: post its summary as a comment and move the issue
/// to the team's review status (each only if asked).
pub async fn finish(id: &str, team: &str, summary: &str, comment: bool, review: bool) -> Result<Finished, String> {
    let mut out = Finished { commented: false, moved_to: None };
    let summary = summary.trim();
    if comment && !summary.is_empty() {
        let body = format!("**Done by Claude Code via Tute**\n\n{summary}");
        call_tool("save_comment", json!({ "issueId": id, "body": body })).await?;
        out.commented = true;
    }
    if review && !team.is_empty() {
        let all = statuses(team).await?;
        if let Some((sid, _, name)) =
            all.iter().find(|(_, t, n)| t == "started" && n.to_lowercase().contains("review"))
        {
            call_tool("save_issue", json!({ "id": id, "state": sid })).await?;
            out.moved_to = Some(name.clone());
        }
    }
    Ok(out)
}

#[derive(Clone, Serialize)]
pub struct Team {
    id: String,
    name: String,
}

pub async fn teams() -> Result<Vec<Team>, String> {
    let reply = call_tool("list_teams", json!({ "limit": 50 })).await?;
    Ok(reply
        .get("teams")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|t| {
                    Some(Team {
                        id: t.get("id")?.as_str()?.to_string(),
                        name: t.get("name")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

#[derive(Clone, Serialize)]
pub struct Created {
    /// The identifier, e.g. DEV-2412 (empty if Linear didn't say).
    id: String,
    url: String,
}

/// A one-line issue in `team`, assigned to the user unless told not to.
pub async fn create_issue(title: &str, team: &str, assign_to_me: bool, priority: u8) -> Result<Created, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Type what needs doing first.".into());
    }
    let mut args = json!({ "team": team, "title": title, "priority": priority.min(4) });
    if assign_to_me {
        args["assignee"] = json!("me");
    }
    let reply = call_tool("save_issue", args).await?;
    // The reply is the saved issue; the identifier and link are all we need.
    let issue = reply.get("issue").unwrap_or(&reply);
    let pick = |keys: &[&str]| {
        keys.iter().find_map(|k| issue.get(*k).and_then(Value::as_str)).unwrap_or("").to_string()
    };
    Ok(Created { id: pick(&["identifier", "id"]), url: pick(&["url"]) })
}

/// Forgets the connection here and revokes the token at Linear.
pub async fn disconnect(app: &AppHandle) -> Result<(), String> {
    if let Some(t) = load() {
        // Best effort: even if Linear can't be reached, the token is gone from here.
        if let Some(endpoint) = &t.revocation_endpoint {
            let token = t.refresh_token.as_deref().unwrap_or(&t.access_token);
            let _ = client()?
                .post(endpoint)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(form(&[("token", token), ("client_id", &t.client_id)]))
                .send()
                .await;
        }
    }
    secrets::forget(secrets::Slot::Login(SECRET))?;
    *PENDING.lock().unwrap() = None;
    log::line("linear: disconnected");
    announce(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc_4648() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn pkce_challenge_matches_rfc_7636_example() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            base64url(&sha256(verifier.as_bytes()).unwrap()),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn form_encodes_values() {
        assert_eq!(form(&[("a", "1 2"), ("b", "x&y")]), "a=1+2&b=x%26y");
    }
}
