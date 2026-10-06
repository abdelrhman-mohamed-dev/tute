// Tute for Windows: wires the app together and holds the commands the pages call.

mod agent;
mod ai;
mod browse;
mod browser;
mod catcher;
mod claude;
mod display;
mod inbox;
mod island;
mod linear;
mod log;
mod memory;
mod obsidian;
mod secrets;
mod settings;
mod tray;
mod watch;

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use settings::Settings;
use watch::Watcher;

/// Spawned helpers get no console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub watcher: Arc<Watcher>,
}

/// The `screen` setting: which display the island lives on.
pub fn screen_pref(app: &AppHandle) -> String {
    app.try_state::<Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into())
}

/// Places the island window again: on its display, panel or strip as it is now.
fn place_island(app: &AppHandle) {
    let folded = app.state::<Shared>().watcher.folded.load(Ordering::Relaxed);
    island::place(app, &screen_pref(app), folded);
}

// ── The island window ─────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: display::ScreenInfo,
    version: String,
}

/// What a page needs to start: the settings, its display, the version.
#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let settings = shared.settings.lock().unwrap().clone();
    BootInfo {
        screen: display::screen(&app, &settings.screen),
        settings,
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Saves the settings, applies what changed outside the page (display,
/// start with Windows), and tells the other window.
#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) {
    let old = std::mem::replace(&mut *shared.settings.lock().unwrap(), settings.clone());
    if let Err(err) = settings::save(&settings) {
        log::line(format!("settings not saved: {err}"));
    }
    if old.autostart != settings.autostart {
        let launcher = app.autolaunch();
        let done = if settings.autostart { launcher.enable() } else { launcher.disable() };
        if let Err(err) = done {
            log::line(format!("start with Windows: {err}"));
        }
    }
    if old.screen != settings.screen {
        place_island(&app);
    }
    let _ = app.emit("settings-changed", settings);
}

/// Hidden: the window folds to the wake strip and the watcher sleeps. Shown:
/// the full panel, watched again.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    shared.watcher.folded.store(collapsed, Ordering::Relaxed);
    place_island(&app);
    // The strip must always take the mouse; after a resize the old state is unknown.
    island::pass_clicks(&app, false);
    shared.watcher.resync();
    shared.watcher.wake(!collapsed);
}

/// The page reports the island's outline; clicks elsewhere pass through.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.watcher.set_area(watch::Area { x, y, w: width, h: height });
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    if let Some(win) = island::window(&app) {
        island::take_keyboard(&win, focused);
    }
}

#[tauri::command]
fn reposition(app: AppHandle) {
    place_island(&app);
}

/// The connected displays, for "Island lives on".
#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<display::MonitorInfo> {
    display::list(&app)
}

/// Opens a web link in the default browser. Nothing but http(s).
#[tauri::command]
fn open_url(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ── Dropped files ─────────────────────────────────────────────────────────────

#[tauri::command]
fn ingest_file(path: String) -> Result<inbox::DroppedFile, String> {
    inbox::take(&path)
}

/// Cancel on the card: deletes the inbox copy, never anything else.
#[tauri::command]
fn discard_file(path: String) -> Result<(), String> {
    inbox::discard(&path)
}

// ── AI providers ──────────────────────────────────────────────────────────────

/// The saved provider with this id. Cloned out, so no lock is held across awaits.
fn provider(shared: &State<'_, Shared>, provider_id: &str) -> Result<settings::Provider, String> {
    shared
        .settings
        .lock()
        .unwrap()
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .cloned()
        .ok_or_else(|| "That provider isn't saved yet.".to_string())
}

/// Stores a provider's key in the Credential Manager. Empty removes it.
#[tauri::command]
fn provider_key_set(provider_id: String, key: String) -> Result<(), String> {
    secrets::write(secrets::Slot::Key(&provider_id), &key)
}

/// The page may only ask whether a key exists — it can never read one.
#[tauri::command]
fn provider_key_present(provider_id: String) -> bool {
    secrets::holds(secrets::Slot::Key(&provider_id))
}

#[tauri::command]
fn provider_key_clear(provider_id: String) -> Result<(), String> {
    secrets::forget(secrets::Slot::Key(&provider_id))
}

#[tauri::command]
fn check_provider_url(url: String) -> Result<(), String> {
    ai::check_base_url(&url).map(|_| ())
}

#[tauri::command]
async fn ai_list_models(shared: State<'_, Shared>, provider_id: String) -> Result<Vec<String>, String> {
    let p = provider(&shared, &provider_id)?;
    ai::list_models(&p).await
}

#[tauri::command]
async fn ai_test(shared: State<'_, Shared>, provider_id: String, model: String) -> Result<ai::TestResult, String> {
    let p = provider(&shared, &provider_id)?;
    let result = ai::test(&p, &model).await;
    match &result {
        Ok(r) => log::line(format!("ai: test {} / {model} ok in {} ms", p.name, r.millis)),
        Err(e) => log::line(format!("ai: test {} / {model} failed: {e}", p.name)),
    }
    result
}

#[derive(serde::Deserialize)]
struct ChatTurn {
    role: String,
    content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatDelta {
    request_id: u64,
    text: String,
}

/// Who the chat is talking to and how: Focus is plain and short; Fun gives each
/// character its own voice (Tute cheeky, Tutee sweet) without ever trading the
/// answer for a joke.
fn chat_system_prompt(tutee: bool, focus: bool) -> String {
    let name = if tutee { "Tutee" } else { "Tute" };
    let base = format!(
        "You are {name}, a little jelly assistant who lives at the top of the user's Windows screen. \
         Answer in the user's language. Use plain text with line breaks — no markdown symbols like ** or ##."
    );
    let voice = match (focus, tutee) {
        (true, _) => {
            "Be short, plain and to the point. No jokes, no emoji, no small talk."
        }
        (false, false) => {
            "Be cheeky and playful: warm teasing, a quick joke when it fits, at most one emoji now and then. \
             You're a jelly and you know it. Keep it short, and always give the real answer first — \
             the fun never replaces the help."
        }
        (false, true) => {
            "Be sweet and encouraging: gentle, cheerful, a little cute, at most one emoji now and then. \
             Cheer the user on when they're stuck. Keep it short, and always give the real answer first — \
             the warmth never replaces the help."
        }
    };
    format!("{base} {voice}")
}

/// Longest conversation sent in one request; older turns are dropped first.
const CHAT_MAX_TURNS: usize = 40;

/// One chat turn with the active model. The reply streams to the island as
/// `chat-delta` events tagged with `request_id`; the full text is returned too.
#[tauri::command]
async fn ai_chat(
    app: AppHandle,
    shared: State<'_, Shared>,
    request_id: u64,
    messages: Vec<ChatTurn>,
    web: bool,
) -> Result<ChatAnswer, String> {
    let (active, personality, chat_mode, memory_on) = {
        let s = shared.settings.lock().unwrap();
        (s.active_model.clone(), s.personality.clone(), s.chat_mode.clone(), s.memory_on)
    };
    let active = active.ok_or_else(|| "Choose a model first (Settings → Chat models).".to_string())?;
    let p = provider(&shared, &active.provider_id)?;

    // Only plain user/assistant turns, ending with the user's.
    let turns: Vec<ai::Turn> = messages
        .iter()
        .filter(|m| (m.role == "user" || m.role == "assistant") && !m.content.trim().is_empty())
        .map(|m| ai::Turn { role: m.role.as_str(), text: m.content.as_str() })
        .collect();
    let turns = &turns[turns.len().saturating_sub(CHAT_MAX_TURNS)..];
    if turns.last().map(|t| t.role) != Some("user") {
        return Err("Nothing to send.".into());
    }

    let mut system = chat_system_prompt(personality.as_deref() == Some("tutee"), chat_mode == "focus");
    // What it remembers, and how to remember more (memory.rs).
    let known = if memory_on { memory::memories() } else { Vec::new() };
    if memory_on {
        system.push_str(&memory::for_model(&known));
        system.push_str(memory::MEMORY_RULES);
    }
    let started = std::time::Instant::now();

    // With the browser extension there, the model may browse (browse.rs). The
    // answer arrives whole, as one piece, once it's done.
    if web && browser::connected() {
        let history = turns.iter().map(|t| serde_json::json!({ "role": t.role, "content": t.text })).collect();
        let system = format!("{system}{}", browse::WEB_RULES);
        let result = browse::chat(&app, &p, &active.model, &system, history, request_id).await;
        return match result {
            Ok((text, sources)) => {
                log::line(format!("ai: chat {} / {} with {} page(s) in {} ms", p.name, active.model, sources.len(), started.elapsed().as_millis()));
                let answer = finish_answer(&text, sources, &known, memory_on);
                let _ = app.emit_to(island::WINDOW_LABEL, "chat-delta", ChatDelta { request_id, text: answer.text.clone() });
                Ok(answer)
            }
            Err(e) => {
                log::line(format!("ai: chat {} / {} failed: {e}", p.name, active.model));
                Err(e)
            }
        };
    }

    let result = ai::stream(&p, &active.model, Some(&system), turns, |text| {
        let _ = app.emit_to(
            island::WINDOW_LABEL,
            "chat-delta",
            ChatDelta { request_id, text: text.to_string() },
        );
    })
    .await;
    match &result {
        Ok(_) => log::line(format!("ai: chat {} / {} in {} ms", p.name, active.model, started.elapsed().as_millis())),
        Err(e) => log::line(format!("ai: chat {} / {} failed: {e}", p.name, active.model)),
    }
    result.map(|text| finish_answer(&text, Vec::new(), &known, memory_on))
}

/// A chat answer: its text (hidden notes cut out), the pages it read if it
/// browsed, what it just remembered, and which memories it used.
#[derive(Serialize)]
struct ChatAnswer {
    text: String,
    sources: Vec<browse::Source>,
    remembered: Vec<memory::Memory>,
    used: Vec<String>,
}

fn finish_answer(reply: &str, sources: Vec<browse::Source>, known: &[memory::Memory], memory_on: bool) -> ChatAnswer {
    let (text, notes) = memory::notes(reply);
    let remembered = if memory_on {
        notes.remember.iter().filter_map(|fact| memory::remember(fact).ok()).collect()
    } else {
        Vec::new()
    };
    let used = notes.used.iter().filter_map(|n| known.get(n.wrapping_sub(1)).map(|m| m.text.clone())).collect();
    ChatAnswer { text, sources, remembered, used }
}

// ── Saved chats and memory ────────────────────────────────────────────────────

#[tauri::command]
fn chats_list(shared: State<'_, Shared>) -> Vec<memory::ChatInfo> {
    let keep = shared.settings.lock().unwrap().chat_keep_days;
    memory::list_chats(keep)
}

#[tauri::command]
fn chat_load(id: String) -> Result<memory::Chat, String> {
    memory::load_chat(&id)
}

#[tauri::command]
fn chat_save(chat: memory::Chat) -> Result<(), String> {
    memory::save_chat(chat)
}

#[tauri::command]
fn chat_delete(id: String) -> Result<(), String> {
    memory::delete_chat(&id)
}

#[tauri::command]
fn chats_clear() -> Result<(), String> {
    memory::clear_chats()
}

#[tauri::command]
fn memory_list() -> Vec<memory::Memory> {
    memory::memories()
}

#[tauri::command]
fn memory_add(text: String) -> Result<memory::Memory, String> {
    memory::remember(&text)
}

#[tauri::command]
fn memory_edit(id: String, text: String) -> Result<(), String> {
    memory::edit(&id, &text)
}

#[tauri::command]
fn memory_forget(id: String) -> Result<(), String> {
    memory::forget(&id)
}

#[tauri::command]
fn memory_forget_all() -> Result<(), String> {
    memory::forget_all()
}

// ── Claude Code ───────────────────────────────────────────────────────────────

#[tauri::command]
fn claude_hooks_status() -> claude::HooksStatus {
    claude::status()
}

/// The island's answer to a question or permission prompt; null hands it back
/// to the terminal.
/// Questions still waiting, for an island that was reloaded while one was up.
#[tauri::command]
fn claude_waiting() -> Vec<claude::ClaudeAsk> {
    claude::waiting()
}

#[tauri::command]
fn claude_reply(request_id: u64, reply: serde_json::Value) {
    claude::reply(request_id, reply);
}

/// Adds Tute's hooks to ~/.claude/settings.json (everything else is kept).
#[tauri::command]
fn claude_hooks_install() -> Result<claude::HooksStatus, String> {
    claude::install()?;
    Ok(claude::status())
}

#[tauri::command]
fn claude_hooks_remove() -> Result<claude::HooksStatus, String> {
    claude::remove()?;
    Ok(claude::status())
}

// ── Linear ────────────────────────────────────────────────────────────────────

#[tauri::command]
fn linear_status() -> linear::LinearStatus {
    linear::status()
}

/// Opens Linear's consent page in the browser; the answer comes back to the
/// local listener (see linear.rs) and arrives here as `linear-changed`.
#[tauri::command]
async fn linear_connect(app: AppHandle) -> Result<(), String> {
    let url = linear::begin(&app).await?;
    open_url(url);
    Ok(())
}

#[tauri::command]
async fn linear_my_issues() -> Result<Vec<linear::Issue>, String> {
    linear::my_issues().await
}

#[tauri::command]
async fn linear_set_state(id: String, state: String, team: String) -> Result<(), String> {
    linear::set_state(&id, &state, &team).await
}

/// Windows' folder picker, for the folder Claude works in.
#[tauri::command]
async fn claude_pick_folder() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| agent::pick_folder("Which folder should Claude work in?"))
        .await
        .ok()
        .flatten()
}

/// "Do it with Claude": moves the issue to In Progress and opens Claude Code
/// on it in `folder`.
#[tauri::command]
async fn claude_do_issue(issue_id: String, team: String, folder: String) -> Result<(), String> {
    let (title, url, description) = linear::issue_brief(&issue_id).await?;
    let task = agent::task_for(&issue_id, &title, &url, &description);
    agent::launch(&folder, &issue_id, &task)?;
    // Best effort: Claude is already on it even if Linear is slow to agree.
    if let Err(e) = linear::set_state(&issue_id, "started", &team).await {
        log::line(format!("agent: couldn't move {issue_id} to In Progress: {e}"));
    }
    Ok(())
}

/// Claude finished an issue: comment its summary, move it to review.
#[tauri::command]
async fn linear_finish_issue(
    id: String,
    team: String,
    summary: String,
    comment: bool,
    review: bool,
) -> Result<linear::Finished, String> {
    linear::finish(&id, &team, &summary, comment, review).await
}

#[tauri::command]
async fn linear_teams() -> Result<Vec<linear::Team>, String> {
    linear::teams().await
}

#[tauri::command]
async fn linear_create_issue(
    title: String,
    team: String,
    assign_to_me: bool,
    priority: u8,
) -> Result<linear::Created, String> {
    linear::create_issue(&title, &team, assign_to_me, priority).await
}

#[tauri::command]
async fn linear_disconnect(app: AppHandle) -> Result<(), String> {
    linear::disconnect(&app).await
}

// ── Browsing ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn browser_status() -> browser::BrowserStatus {
    browser::status()
}

/// Writes the extension (with this PC's token) and shows its folder in Explorer.
#[tauri::command]
fn browser_setup() -> Result<String, String> {
    let dir = browser::install()?;
    let _ = Command::new("explorer.exe").arg(&dir).spawn();
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn browse_stop(id: String) {
    browse::stop(&id);
}

/// Brings a browsing chat's tab to the front, so you can watch it work.
#[tauri::command]
async fn browse_watch(id: String) -> Result<(), String> {
    browser::command("watch", serde_json::json!({ "task": id }), std::time::Duration::from_secs(5)).await.map(|_| ())
}

// ── Obsidian ──────────────────────────────────────────────────────────────────

/// The chosen vault's folder.
fn vault(shared: &State<'_, Shared>) -> Option<String> {
    shared.settings.lock().unwrap().obsidian_vault.clone()
}

/// The vaults Obsidian knows about, most recent first.
#[tauri::command]
fn obsidian_vaults() -> Vec<obsidian::Vault> {
    obsidian::vaults()
}

/// Windows' folder picker, for a vault Obsidian's list doesn't have; checked to be a vault.
#[tauri::command]
async fn obsidian_pick() -> Result<Option<obsidian::Vault>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| agent::pick_folder("Which folder is your Obsidian vault?"))
        .await
        .map_err(|e| e.to_string())?;
    picked.map(|p| obsidian::check(&p)).transpose()
}

#[tauri::command]
fn obsidian_capture(shared: State<'_, Shared>, text: String) -> Result<obsidian::Added, String> {
    obsidian::capture(vault(&shared).as_deref(), &text)
}

#[tauri::command]
fn obsidian_open_today(shared: State<'_, Shared>) -> Result<(), String> {
    obsidian::open_today(vault(&shared).as_deref())
}

#[tauri::command]
fn obsidian_open(shared: State<'_, Shared>, path: String) -> Result<(), String> {
    obsidian::open(vault(&shared).as_deref(), &path)
}

/// Reads up to a few thousand notes, so it runs off the main thread.
#[tauri::command]
async fn obsidian_search(shared: State<'_, Shared>, query: String) -> Result<Vec<obsidian::Found>, String> {
    let vault = vault(&shared);
    tauri::async_runtime::spawn_blocking(move || obsidian::search(vault.as_deref(), &query))
        .await
        .map_err(|e| e.to_string())?
}

/// A dropped file (already in the inbox) goes into the vault, linked in today's note.
#[tauri::command]
fn obsidian_save_file(shared: State<'_, Shared>, path: String) -> Result<obsidian::Added, String> {
    obsidian::save_file(vault(&shared).as_deref(), &path)
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── The settings window ───────────────────────────────────────────────────────

/// WebView2 gives an app one browser environment, set up by the first webview.
/// Every later window must ask for exactly the same arguments as the island
/// (`additionalBrowserArgs` in tauri.conf.json), or it comes up blank, silently.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// The settings page: from Vite in a dev build, from the bundle otherwise.
fn settings_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut url) = app.config().build.dev_url.clone() {
        url.set_path("/settings.html");
        return WebviewUrl::External(url);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// Made hidden at launch, before the island's webview, and only shown and
/// hidden after that: a WebView2 window made later comes up blank.
fn create_settings_window(app: &AppHandle) {
    let made = WebviewWindowBuilder::new(app, "settings", settings_url(app))
        .additional_browser_args(BROWSER_ARGS)
        .title("Settings — Tute")
        .inner_size(620.0, 720.0)
        .min_inner_size(460.0, 400.0)
        .visible(false)
        .center()
        .build();
    match made {
        // Closing only hides it, so it can be opened again.
        Ok(win) => win.clone().on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        }),
        Err(err) => log::line(format!("no settings window: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    match app.get_webview_window("settings") {
        Some(win) => {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        None => log::line("the settings window is missing"),
    }
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

// ── Start ─────────────────────────────────────────────────────────────────────

pub fn run() {
    let settings = settings::load();
    let watcher = Arc::new(Watcher::new());

    tauri::Builder::default()
        // A second launch just opens the island of the first.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
        }))
        // The launcher kind only matters on macOS; Windows uses the Run key.
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Shared { settings: Mutex::new(settings.clone()), watcher: watcher.clone() })
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            list_monitors,
            open_url,
            quit_app,
            ingest_file,
            discard_file,
            provider_key_set,
            provider_key_present,
            provider_key_clear,
            check_provider_url,
            ai_list_models,
            ai_test,
            ai_chat,
            claude_hooks_status,
            claude_reply,
            claude_waiting,
            claude_hooks_install,
            claude_hooks_remove,
            linear_status,
            linear_connect,
            linear_disconnect,
            linear_my_issues,
            linear_set_state,
            claude_pick_folder,
            claude_do_issue,
            linear_finish_issue,
            linear_teams,
            linear_create_issue,
            log_line,
            chats_list,
            chat_load,
            chat_save,
            chat_delete,
            chats_clear,
            memory_list,
            memory_add,
            memory_edit,
            memory_forget,
            memory_forget_all,
            browser_status,
            browser_setup,
            browse_stop,
            browse_watch,
            obsidian_vaults,
            obsidian_pick,
            obsidian_capture,
            obsidian_open_today,
            obsidian_open,
            obsidian_search,
            obsidian_save_file,
            open_settings_window,
        ])
        .setup(move |app| {
            let app = app.handle().clone();
            tray::build(&app)?;
            create_settings_window(&app); // before the island's webview, see above
            catcher::create(&app);
            if let Some(win) = island::window(&app) {
                island::stay_unfocused(&win);
                island::place(&app, &settings.screen, false);
                let _ = win.show();
            }
            watcher.folded.store(false, Ordering::Relaxed);
            watcher.wake(true);
            watch::spawn(app.clone(), watcher.clone());
            claude::spawn_listener(app.clone()); // Claude Code reports in here
            log::line(format!("--- Tute {} started ---", env!("CARGO_PKG_VERSION")));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tute couldn't start");
}
