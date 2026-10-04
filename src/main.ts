// Entry point: boot the bridge, wire the island, start the greeting.

import "./styles/index.css";
import { Bridge, IS_TAURI, LinearBridge, onEvent, type LinearStatus } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { wireClaude } from "./island/claude";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
  }
  island.applySettings();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        State.paused = false;
        island.alert("settings");
        break;
      case "open":
        State.paused = false;
        island.alert(State.defaultView());
        break;
      case "pause":
        State.paused = !State.paused;
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // Claude Code sessions (hooks → src-tauri/src/claude.rs → here).
  await wireClaude(island);

  // Linear: the home screen's first quick action.
  State.linear = await LinearBridge.status();
  await onEvent<LinearStatus>("linear-changed", (s) => {
    const justConnected = s.connected && !State.linear?.connected;
    State.linear = s;
    if (!s.connected) {
      // Disconnected: nothing of the workspace stays behind on screen.
      State.linearIssues = null;
      State.linearTeams = null;
      State.linearError = null;
      State.linearUndo = null;
    }
    if (justConnected) {
      Sound.play("approve");
      island.emote("happy");
    }
    State.notify();
  });

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
  });

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
