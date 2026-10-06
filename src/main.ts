// The island page starts here: build the island, load the settings, listen to
// Rust (cursor, tray, displays, settings, Claude Code, Linear), then greet.

import "./styles/index.css";
import { Bridge, IS_TAURI, LinearBridge, onEvent, type LinearStatus } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { wireClaude } from "./island/claude";
import { Island } from "./island/island";

/** The tray menu: Open, Settings, Pause / Resume. */
function onTray(island: Island, item: string) {
  if (item === "pause") {
    State.paused = !State.paused;
    if (State.paused) island.fsm.forceHidden();
    else island.reveal();
    return;
  }
  State.paused = false;
  island.alert(item === "settings" ? "settings" : State.defaultView());
}

/** Linear connected or disconnected (from either window). */
function onLinear(island: Island, status: LinearStatus) {
  const welcome = status.connected && !State.linear?.connected;
  State.linear = status;
  if (!status.connected) {
    // Disconnected: nothing of the workspace stays on screen.
    State.linearIssues = State.linearTeams = null;
    State.linearError = null;
    State.linearUndo = null;
  }
  if (welcome) {
    Sound.play("approve");
    island.emote("happy");
  }
  State.notify();
}

async function main() {
  const root = document.getElementById("root");
  if (!root) return;
  void Sound.preload();
  const island = new Island(root);

  const boot = await Bridge.boot();
  State.settings = { ...State.settings, ...boot?.settings };
  island.applySettings();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));
  await onEvent<string>("tray", (item) => onTray(island, item));
  await onEvent<null>("screen-changed", () => void Bridge.reposition());
  // Changed in the settings window: applied at once.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
  });
  await wireClaude(island);
  State.linear = await LinearBridge.status();
  await onEvent<LinearStatus>("linear-changed", (s) => onLinear(island, s));

  island.launch();

  // In a browser nothing unlocks audio until the first click.
  if (!IS_TAURI) document.addEventListener("click", () => Sound.resume(), { once: true });
}

void main();
