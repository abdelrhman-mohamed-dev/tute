// What the views can ask the island to do: every button, toggle and card
// answer ends up here. Kept apart from the controller so island.ts is only
// about modes, views and frames.

import { Bridge, LinearBridge } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Skin } from "../jelly/looks";
import type { ViewActions } from "../views/views";
import { setSkin, setWear } from "./bond";
import type { Island } from "./island";
import { linearActions } from "./linear";

/** Saves the settings (which also tells the settings window) and redraws. */
function save() {
  void Bridge.saveSettings(State.settings);
  State.notify();
}

export function islandActions(island: Island): ViewActions {
  const engine = island.character.engine;
  let tryOnTimer: number | null = null;

  return {
    setView: (v) => island.setView(v),
    collapse: () => island.collapse(),
    setFocus: (id) => {
      State.setFocus(id);
      Sound.play("blip");
    },
    openUrl: (url) => {
      if (url) void Bridge.openUrl(url);
    },
    keepFile: () => island.drop.keep(),
    cancelFile: () => island.drop.cancel(),
    blip: () => Sound.play("blip"),
    emote: (name) => island.emote(name),
    answerAsk: (id, reply) => island.onAnswerAsk?.(id, reply),
    openSettingsWindow: () => void Bridge.openSettingsWindow(),
    saveSettings: () => void Bridge.saveSettings(State.settings),

    // ── Settings ──
    toggleSound: () => {
      State.settings.soundEnabled = !State.settings.soundEnabled;
      Sound.setEnabled(State.settings.soundEnabled);
      save();
    },
    setVolume: (v) => {
      State.settings.soundVolume = v;
      Sound.setVolume(v);
      save();
    },
    setAutoClose: (seconds) => {
      State.settings.autoCloseInterval = seconds;
      island.fsm.homeToBarDelay = seconds;
      save();
    },
    setActiveModel: (m) => {
      State.settings.activeModel = m;
      Sound.play("blip");
      save();
    },
    setChatMode: (mode) => {
      if (State.settings.chatMode === mode) return;
      State.settings.chatMode = mode;
      Sound.play("blip");
      if (mode === "fun") engine.triggerEmote("wink");
      save();
    },

    // ── The character ──
    pickPersonality: (p) => {
      // First launch: save the pick, let it react for a beat, then greet with it.
      State.settings.personality = p;
      void Bridge.saveSettings(State.settings);
      island.applySettings();
      Sound.play("love");
      window.setTimeout(() => {
        island.dropPin();
        island.fsm.launch();
      }, 650);
    },
    setPersonality: (p) => {
      if (State.settings.personality === p) return;
      State.settings.personality = p;
      void Bridge.saveSettings(State.settings);
      island.applySettings();
      Sound.play("pop");
      engine.triggerEmote("happy");
    },
    setWear: (wear) => {
      setWear(wear);
      island.applySettings();
      Sound.play(wear ? "pop" : "blip");
      if (wear) engine.triggerEmote("proud");
    },
    setSkin: (skin) => {
      setSkin(skin);
      island.applySettings();
      Sound.play("pop");
      engine.triggerEmote("happy");
    },
    tryOn: (look: { wear?: "hat" | "crown"; skin?: Skin }) => {
      // A locked look, worn for four seconds.
      if (tryOnTimer != null) window.clearTimeout(tryOnTimer);
      island.dress(look);
      Sound.play("pop");
      engine.triggerEmote("surprised");
      tryOnTimer = window.setTimeout(() => {
        tryOnTimer = null;
        island.dress();
      }, 4000);
    },
    twirl: () => {
      engine.twirl();
      Sound.play("pop");
      island.kick();
    },

    // ── Linear ──
    linearAction: () => {
      // Home quick action: connect Linear, or open it once connected.
      Sound.play("blip");
      if (State.linear?.connected) {
        island.setView("linear");
        return;
      }
      LinearBridge.connect().catch((err) => {
        Sound.play("error");
        island.note(String(err).replace(/^Error:\s*/, ""), 3200);
      });
    },
    linear: linearActions(island),
  };
}
