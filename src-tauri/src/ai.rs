// AI providers: one HTTP client (reqwest), two wire protocols.
//
//   OpenAI-compatible  POST {base}/chat/completions — OpenAI, GLM (Z.ai and
//                      BigModel), DeepSeek, OpenRouter, Groq, Ollama, LM Studio…
//   Anthropic          POST {base}/v1/messages — Claude, spoken natively rather
//                      than through Anthropic's OpenAI-compatibility layer,
//                      which is meant for testing and drops Claude features.
//
// Keys come from the Credential Manager (secrets.rs) and never leave Rust; the
// page only names a provider and a model. Requests go only to the links the
// user configured.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::secrets;
use crate::settings::{Provider, ProviderKind};

const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Server-side fallback on the Claude API: if a model declines on a policy
/// ground, the API re-runs the request on a suitable fallback inside the same
/// call. Sent only for the Claude models that accept it (see `fallback_model`).
const ANTHROPIC_FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// Claude needs an output cap; this leaves room for thinking plus the answer.
const ANTHROPIC_MAX_TOKENS: u32 = 16_000;
/// Streamed requests have no HTTP timeout problem, so give long answers room.
const ANTHROPIC_STREAM_MAX_TOKENS: u32 = 64_000;
const TIMEOUT: Duration = Duration::from_secs(90);
/// What the Test button sends.
const TEST_PROMPT: &str = "Reply with one short, friendly sentence to confirm you can hear me.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub reply: String,
    pub millis: u64,
}

/// One message of a conversation, in the order sent.
pub struct Turn<'a> {
    pub role: &'a str,
    pub text: &'a str,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("Tute/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// A provider link must be https, or plain http to this machine (Ollama, LM
/// Studio): a key must never travel unencrypted across a network.
pub fn check_base_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "That link isn't a valid URL.".to_string())?;
    let local = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if local => Ok(parsed),
        _ => Err("Use an https:// link (plain http only works for localhost).".into()),
    }
}

/// `base` + `path`, without doubling slashes or the `/v1` the user may have typed.
fn endpoint(base: &str, path: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    let path = path.trim_start_matches('/');
    if let Some(rest) = path.strip_prefix("v1/") {
        if base.ends_with("/v1") {
            return format!("{base}/{rest}");
        }
    }
    format!("{base}/{path}")
}

fn key_for(provider: &Provider) -> Option<String> {
    secrets::read(secrets::Slot::Key(&provider.id))
}

fn require_key(provider: &Provider) -> Result<String, String> {
    key_for(provider).ok_or_else(|| format!("Add the API key for {} first.", provider.name))
}

/// The Claude models that accept `fallbacks: "default"` — only on the Claude API.
fn fallback_model(provider: &Provider, model: &str) -> bool {
    let claude_api = provider.base_url.contains("api.anthropic.com");
    claude_api && matches!(model, "claude-fable-5-1" | "claude-opus-5-5" | "claude-opus-5" | "claude-sonnet-5-5")
}

// ── Requests ──────────────────────────────────────────────────────────────────

/// Sends a conversation and returns the reply text.
pub async fn complete(
    provider: &Provider,
    model: &str,
    system: Option<&str>,
    turns: &[Turn<'_>],
) -> Result<String, String> {
    check_base_url(&provider.base_url)?;
    if model.trim().is_empty() {
        return Err("Pick a model first.".into());
    }
    match provider.kind {
        ProviderKind::OpenAi => openai_complete(provider, model, system, turns).await,
        ProviderKind::Anthropic => anthropic_complete(provider, model, system, turns).await,
    }
}

async fn openai_complete(
    provider: &Provider,
    model: &str,
    system: Option<&str>,
    turns: &[Turn<'_>],
) -> Result<String, String> {
    let mut messages = Vec::new();
    if let Some(s) = system {
        messages.push(json!({ "role": "system", "content": s }));
    }
    for t in turns {
        messages.push(json!({ "role": t.role, "content": t.text }));
    }
    // No max-tokens field: newer OpenAI models reject the old name and other
    // providers don't need it, so each one uses its own default.
    let body = json!({ "model": model, "messages": messages });

    let mut req = client()?.post(endpoint(&provider.base_url, "chat/completions")).json(&body);
    // Local servers (Ollama, LM Studio) usually run without a key.
    if let Some(key) = key_for(provider) {
        req = req.bearer_auth(key);
    }
    let value = send(req, provider).await?;

    let message = &value["choices"][0]["message"];
    let text = match &message["content"] {
        Value::String(s) => s.clone(),
        // Some providers return content as a list of parts.
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    };
    if !text.trim().is_empty() {
        return Ok(text.trim().to_string());
    }
    // Reasoning models (GLM, DeepSeek) can put everything in a separate field.
    if let Some(r) = message["reasoning_content"].as_str().filter(|r| !r.trim().is_empty()) {
        return Ok(r.trim().to_string());
    }
    Err("The model answered with an empty reply.".into())
}

async fn anthropic_complete(
    provider: &Provider,
    model: &str,
    system: Option<&str>,
    turns: &[Turn<'_>],
) -> Result<String, String> {
    let key = require_key(provider)?;
    let messages: Vec<Value> = turns
        .iter()
        .map(|t| json!({ "role": t.role, "content": t.text }))
        .collect();
    let mut body = json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "messages": messages,
    });
    if let Some(s) = system {
        body["system"] = json!(s);
    }

    let mut req = client()?
        .post(endpoint(&provider.base_url, "v1/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION);
    if fallback_model(provider, model) {
        body["fallbacks"] = json!("default");
        req = req.header("anthropic-beta", ANTHROPIC_FALLBACK_BETA);
    }
    let value = send(req.json(&body), provider).await?;

    // A policy decline is a normal 200 with stop_reason "refusal".
    if value["stop_reason"] == "refusal" {
        return Err("The model declined this request.".into());
    }
    let text = value["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err("The model answered with an empty reply.".into());
    }
    Ok(text.trim().to_string())
}

// ── Streaming (the island's chat) ─────────────────────────────────────────────

/// Like `complete`, but streams: `on_text` gets each piece of the answer as it
/// arrives. Returns the whole answer at the end.
pub async fn stream(
    provider: &Provider,
    model: &str,
    system: Option<&str>,
    turns: &[Turn<'_>],
    mut on_text: impl FnMut(&str),
) -> Result<String, String> {
    check_base_url(&provider.base_url)?;
    if model.trim().is_empty() {
        return Err("Pick a model first.".into());
    }
    let req = match provider.kind {
        ProviderKind::OpenAi => {
            let mut messages = Vec::new();
            if let Some(s) = system {
                messages.push(json!({ "role": "system", "content": s }));
            }
            for t in turns {
                messages.push(json!({ "role": t.role, "content": t.text }));
            }
            let body = json!({ "model": model, "messages": messages, "stream": true });
            let mut r = stream_client()?.post(endpoint(&provider.base_url, "chat/completions")).json(&body);
            if let Some(key) = key_for(provider) {
                r = r.bearer_auth(key);
            }
            r
        }
        ProviderKind::Anthropic => {
            let messages: Vec<Value> = turns
                .iter()
                .map(|t| json!({ "role": t.role, "content": t.text }))
                .collect();
            let mut body = json!({
                "model": model,
                "max_tokens": ANTHROPIC_STREAM_MAX_TOKENS,
                "messages": messages,
                "stream": true,
            });
            if let Some(s) = system {
                body["system"] = json!(s);
            }
            let mut r = stream_client()?
                .post(endpoint(&provider.base_url, "v1/messages"))
                .header("x-api-key", require_key(provider)?)
                .header("anthropic-version", ANTHROPIC_VERSION);
            if fallback_model(provider, model) {
                body["fallbacks"] = json!("default");
                r = r.header("anthropic-beta", ANTHROPIC_FALLBACK_BETA);
            }
            r.json(&body)
        }
    };

    let mut resp = req.send().await.map_err(|e| connection_error(&e, provider))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(http_error(status.as_u16(), &text));
    }

    // Server-sent events: lines of `data: {json}`, possibly split across chunks.
    let mut pending = String::new();
    let mut answer = String::new();
    let mut reasoning = String::new();
    loop {
        let chunk = match tokio_timeout(resp.chunk()).await {
            Ok(Ok(Some(bytes))) => bytes,
            Ok(Ok(None)) => break,
            Ok(Err(e)) => return Err(connection_error(&e, provider)),
            Err(()) => return Err(format!("{} stopped sending for {} s.", provider.name, STALL.as_secs())),
        };
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(nl) = pending.find('\n') {
            let line = pending[..nl].trim_end_matches('\r').to_string();
            pending.drain(..=nl);
            let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
            match provider.kind {
                ProviderKind::OpenAi => {
                    if let Some(msg) = event["error"]["message"].as_str() {
                        return Err(format!("{}: {msg}", provider.name));
                    }
                    let delta = &event["choices"][0]["delta"];
                    if let Some(text) = delta["content"].as_str().filter(|t| !t.is_empty()) {
                        answer.push_str(text);
                        on_text(text);
                    } else if let Some(r) = delta["reasoning_content"].as_str() {
                        // Reasoning models think out loud first; kept only as a
                        // fallback if no real answer ever comes.
                        reasoning.push_str(r);
                    }
                }
                ProviderKind::Anthropic => match event["type"].as_str() {
                    Some("content_block_delta") if event["delta"]["type"] == "text_delta" => {
                        if let Some(text) = event["delta"]["text"].as_str() {
                            answer.push_str(text);
                            on_text(text);
                        }
                    }
                    Some("message_delta") if event["delta"]["stop_reason"] == "refusal" => {
                        return Err("The model declined this request.".into());
                    }
                    Some("error") => {
                        let msg = event["error"]["message"].as_str().unwrap_or("stream error");
                        return Err(format!("{}: {msg}", provider.name));
                    }
                    _ => {}
                },
            }
        }
    }

    if answer.trim().is_empty() {
        if !reasoning.trim().is_empty() {
            on_text(reasoning.trim());
            return Ok(reasoning.trim().to_string());
        }
        return Err("The model answered with an empty reply.".into());
    }
    Ok(answer)
}

/// No overall timeout for a stream — long answers are fine — but a stream that
/// goes silent this long is treated as dead.
const STALL: Duration = Duration::from_secs(60);

fn stream_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent(concat!("Tute/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

async fn tokio_timeout<F: std::future::Future>(f: F) -> Result<F::Output, ()> {
    tokio::time::timeout(STALL, f).await.map_err(|_| ())
}

fn connection_error(e: &reqwest::Error, provider: &Provider) -> String {
    if e.is_timeout() {
        format!("{} didn't answer in time.", provider.name)
    } else if e.is_connect() {
        format!("Couldn't reach {}. Check the link and your connection.", provider.name)
    } else {
        format!("Request to {} failed.", provider.name)
    }
}

/// The models a provider offers, for the "Fetch models" button.
pub async fn list_models(provider: &Provider) -> Result<Vec<String>, String> {
    check_base_url(&provider.base_url)?;
    let req = match provider.kind {
        ProviderKind::OpenAi => {
            let mut r = client()?.get(endpoint(&provider.base_url, "models"));
            if let Some(key) = key_for(provider) {
                r = r.bearer_auth(key);
            }
            r
        }
        ProviderKind::Anthropic => client()?
            .get(endpoint(&provider.base_url, "v1/models?limit=100"))
            .header("x-api-key", require_key(provider)?)
            .header("anthropic-version", ANTHROPIC_VERSION),
    };
    let value = send(req, provider).await?;
    let mut ids: Vec<String> = value["data"]
        .as_array()
        .map(|list| list.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    if ids.is_empty() {
        return Err("This provider didn't list any models. Type the model name instead.".into());
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// The Test button: one short message, timed.
pub async fn test(provider: &Provider, model: &str) -> Result<TestResult, String> {
    let started = Instant::now();
    let reply = complete(provider, model, None, &[Turn { role: "user", text: TEST_PROMPT }]).await?;
    Ok(TestResult { reply, millis: started.elapsed().as_millis() as u64 })
}

// ── Tools (the browsing helper) ───────────────────────────────────────────────

/// A tool the model may call. `schema` is the JSON Schema of its input.
pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: Value,
}

/// The model asking for a tool.
pub struct Call {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// One reply in a tool-using conversation: what it said, and the tools it wants.
pub struct Reply {
    pub text: String,
    pub calls: Vec<Call>,
}

/// How long the answer to a single tool step may be.
const TOOL_MAX_TOKENS: u32 = 4096;

/// One step of a conversation with tools. `messages` is kept in the

/// provider's own format: it starts with `user_message`, and this adds the

/// model's turn to it. Answer its calls with `tool_results` and step again.
pub async fn tool_step(
    provider: &Provider,
    model: &str,
    system: &str,
    messages: &mut Vec<Value>,
    tools: &[Tool],
) -> Result<Reply, String> {
    check_base_url(&provider.base_url)?;
    match provider.kind {
        ProviderKind::Anthropic => {
            let body = json!({
                "model": model,
                "max_tokens": TOOL_MAX_TOKENS,
                "system": system,
                "messages": messages,
                "tools": tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.schema })).collect::<Vec<_>>(),
            });
            let req = client()?
                .post(endpoint(&provider.base_url, "v1/messages"))
                .header("x-api-key", require_key(provider)?)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&body);
            let value = send(req, provider).await?;
            if value["stop_reason"] == "refusal" {
                return Err("The model declined this request.".into());
            }
            let blocks = value["content"].as_array().cloned().unwrap_or_default();
            let text = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("");
            let calls = blocks
                .iter()
                .filter(|b| b["type"] == "tool_use")
                .map(|b| Call {
                    id: b["id"].as_str().unwrap_or("").to_string(),
                    name: b["name"].as_str().unwrap_or("").to_string(),
                    input: b["input"].clone(),
                })
                .collect();
            messages.push(json!({ "role": "assistant", "content": blocks }));
            Ok(Reply { text: text.trim().to_string(), calls })
        }
        ProviderKind::OpenAi => {
            let mut all = vec![json!({ "role": "system", "content": system })];
            all.extend(messages.iter().cloned());
            let body = json!({
                "model": model,
                "messages": all,
                "tools": tools.iter().map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.schema } })).collect::<Vec<_>>(),
            });
            let mut req = client()?.post(endpoint(&provider.base_url, "chat/completions")).json(&body);
            if let Some(key) = key_for(provider) {
                req = req.bearer_auth(key);
            }
            let value = send(req, provider).await?;
            let message = value["choices"][0]["message"].clone();
            let text = message["content"].as_str().unwrap_or("").trim().to_string();
            let calls = message["tool_calls"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .map(|c| Call {
                            id: c["id"].as_str().unwrap_or("").to_string(),
                            name: c["function"]["name"].as_str().unwrap_or("").to_string(),
                            // Arguments come as a JSON string.
                            input: c["function"]["arguments"].as_str().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null),
                        })
                        .collect()
                })
                .unwrap_or_default();
            messages.push(message);
            Ok(Reply { text, calls })
        }
    }
}

/// The first message of a tool conversation.
pub fn user_message(text: &str) -> Value {
    json!({ "role": "user", "content": text })
}

/// Answers the model's tool calls: (call id, what came back).
pub fn tool_results(provider: &Provider, messages: &mut Vec<Value>, results: Vec<(String, String)>) {
    match provider.kind {
        ProviderKind::Anthropic => messages.push(json!({
            "role": "user",
            "content": results.into_iter().map(|(id, text)| json!({ "type": "tool_result", "tool_use_id": id, "content": text })).collect::<Vec<_>>(),
        })),
        ProviderKind::OpenAi => {
            for (id, text) in results {
                messages.push(json!({ "role": "tool", "tool_call_id": id, "content": text }));
            }
        }
    }
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

/// Sends, and turns every failure into a sentence a person can act on. Error
/// text comes from the provider's response body or reqwest — never from the
/// request, so a key can't end up in a message or the log.
async fn send(req: reqwest::RequestBuilder, provider: &Provider) -> Result<Value, String> {
    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("{} didn't answer within {} s.", provider.name, TIMEOUT.as_secs())
        } else if e.is_connect() {
            format!("Couldn't reach {}. Check the link and your connection.", provider.name)
        } else {
            format!("Request to {} failed.", provider.name)
        }
    })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status.is_success() {
        return serde_json::from_str(&text)
            .map_err(|_| format!("{} sent a reply tute couldn't read.", provider.name));
    }
    Err(http_error(status.as_u16(), &text))
}

fn http_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["message"].as_str())
                .or_else(|| v["error"].as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| body.trim().to_string());
    let detail: String = detail.chars().take(240).collect();
    let what = match status {
        401 | 403 => "The key was rejected",
        404 => "Not found: check the link and the model name",
        429 => "Rate limited, or out of credit",
        500..=599 => "The provider had a problem",
        _ => "The request failed",
    };
    if detail.is_empty() {
        format!("{what} (HTTP {status}).")
    } else {
        format!("{what} (HTTP {status}): {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_must_be_https_unless_local() {
        assert!(check_base_url("https://api.z.ai/api/paas/v4").is_ok());
        assert!(check_base_url("http://localhost:11434/v1").is_ok());
        assert!(check_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert!(check_base_url("http://api.example.com/v1").is_err());
        assert!(check_base_url("ftp://example.com").is_err());
        assert!(check_base_url("not a url").is_err());
    }

    #[test]
    fn endpoints_join_cleanly() {
        assert_eq!(endpoint("https://api.openai.com/v1/", "chat/completions"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(endpoint("https://api.anthropic.com", "v1/messages"), "https://api.anthropic.com/v1/messages");
        assert_eq!(endpoint("https://api.anthropic.com/v1", "v1/messages"), "https://api.anthropic.com/v1/messages");
        assert_eq!(endpoint("https://api.z.ai/api/paas/v4", "models"), "https://api.z.ai/api/paas/v4/models");
    }

    #[test]
    fn errors_read_like_sentences() {
        let e = http_error(401, r#"{"error":{"message":"invalid x-api-key"}}"#);
        assert!(e.starts_with("The key was rejected") && e.contains("invalid x-api-key"));
        assert_eq!(http_error(500, ""), "The provider had a problem (HTTP 500).");
    }
}
