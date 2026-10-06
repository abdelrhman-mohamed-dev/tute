// Buddy: who's on your screen, how it talks, how it sounds, and your bond.

import type { Settings } from "../core/state";
import { LOOKS, PERSONALITIES } from "../jelly/looks";
import { JellyPreview } from "../jelly/preview";
import { LEVELS, UNLOCK_SHORT, levelFor, nextLevel } from "../island/bond";
import { ICONS } from "../views/icons";
import { h } from "../views/kit";
import { choice, group, item, onOff, type Page, type SettingsHost } from "./form";

/** The two characters, live, side by side; the chosen one is outlined. */
function characters(host: SettingsHost): { el: HTMLElement; sync(): void } {
  const tiles = PERSONALITIES.map((id) => {
    const live = new JellyPreview(LOOKS[id], 72, 20);
    const tile = h(
      "button",
      {
        class: `buddy-tile ${id}`,
        title: `Use ${LOOKS[id].name}`,
        onmouseenter: () => {
          live.engine.tgEs = 1.08;
          live.engine.triggerEmote(id === "tutee" ? "love" : "happy");
        },
        onmouseleave: () => {
          live.engine.tgEs = 1;
        },
        onclick: () => {
          const s = host.settings();
          if (s.personality === id) return;
          s.personality = id;
          live.engine.triggerEmote("happy");
          sync();
          void host.save();
        },
      },
      live.canvas,
      h("span", { class: "buddy-name", text: LOOKS[id].name }),
      h("span", { class: "buddy-what", text: id === "tutee" ? "Sweet and cheerful" : "Cheeky and playful" }),
    );
    return { id, tile, live };
  });

  const sync = () => {
    const chosen = host.settings().personality ?? "tute";
    for (const t of tiles) t.tile.classList.toggle("on", t.id === chosen);
  };

  // They move only while you can see them: in the background the window
  // draws one still frame and then costs nothing.
  let mouse = { x: 0, y: 0 };
  let running = false;
  window.addEventListener("mousemove", (e) => {
    mouse = { x: e.clientX, y: e.clientY };
  });
  const frame = (nowMs: number) => {
    const shown = tiles[0].tile.isConnected && document.visibilityState === "visible" && document.hasFocus();
    for (const { live } of tiles) {
      live.lookAt(mouse.x, mouse.y);
      live.tick(nowMs);
    }
    if (shown) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      for (const { live } of tiles) live.pause();
    }
  };
  const start = () => {
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  };
  window.addEventListener("focus", start);
  document.addEventListener("visibilitychange", start);

  return {
    el: h("div", { class: "buddy-tiles" }, ...tiles.map((t) => t.tile)),
    sync: () => {
      sync();
      start();
    },
  };
}

/** Your bond: the level, how far to the next, and what that unlocks. */
function bondCard(host: SettingsHost): { el: HTMLElement; sync(): void } {
  const name = h("div", { class: "bond-name" });
  const meta = h("div", { class: "item-about" });
  const fill = h("i");
  const next = h("div", { class: "item-about" });
  const el = h("div", { class: "bond" }, h("div", { class: "bond-head" }, name, meta), h("div", { class: "bond-bar" }, fill), next);
  return {
    el,
    sync() {
      const b = host.settings().bond;
      const points = b?.points ?? 0;
      const level = levelFor(points);
      const up = nextLevel(points);
      name.textContent = `Level ${level.level} · ${level.name}`;
      const days = b ? Math.max(1, Math.floor((Date.now() - b.since) / 86_400_000) + 1) : 0;
      meta.textContent = b ? `${points} points · together ${days} day${days === 1 ? "" : "s"}` : "It starts the first time you chat, pet it or finish something together.";
      fill.style.width = `${up ? ((points - level.at) / (up.at - level.at)) * 100 : 100}%`;
      next.textContent = up
        ? `Next: ${up.unlock ? UNLOCK_SHORT[up.unlock] : up.name} at ${up.at} points`
        : `Every reward unlocked (${LEVELS.length} levels). Legends forever.`;
    },
  };
}

export function buddyPage(host: SettingsHost): Page {
  const s = host.settings();
  const set = (change: (s: Settings) => void) => {
    change(host.settings());
    void host.save();
  };

  const who = characters(host);
  const voice = choice(
    [
      { value: "fun", label: "Fun" },
      { value: "focus", label: "Focus" },
    ],
    s.chatMode,
    (mode) => set((s) => (s.chatMode = mode)),
  );
  const volume = h("input", { type: "range", min: "0", max: "0.2", step: "0.005", value: String(s.soundVolume), title: "Volume" });
  volume.addEventListener("input", () => set((s) => (s.soundVolume = Number(volume.value))));
  const sound = onOff(s.soundEnabled, (on) => {
    volume.disabled = !on;
    set((s) => (s.soundEnabled = on));
  });
  volume.disabled = !s.soundEnabled;
  const bond = bondCard(host);

  return {
    id: "buddy",
    title: "Buddy",
    lead: "Who lives on your screen, and how it behaves.",
    icon: ICONS.heart,
    el: h(
      "div",
      {},
      who.el,
      group(
        null,
        item("Chat voice", "Fun is playful and cheeky; Focus is short and plain.", voice),
        item("Sound", "Little sounds when things happen. Made in code, nothing downloaded.", volume, sound),
      ),
      group("Your bond", bond.el),
    ),
    sync() {
      const now = host.settings();
      who.sync();
      voice.set(now.chatMode);
      bond.sync();
    },
  };
}
