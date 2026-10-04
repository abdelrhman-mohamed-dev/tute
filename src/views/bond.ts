// The bond views: the level-up card (confetti, what was unlocked, "Wear it")
// and the bond page (level, progress, what's next, what to wear, colours).

import { h, clear } from "./kit";
import { State } from "../core/state";
import { activeLook } from "../jelly/looks";
import {
  LEVELS, UNLOCK_SHORT, UNLOCK_TEXT, bond, daysTogether, has, levelFor, nextLevel,
} from "../island/bond";
import type { ViewActions, ViewHost } from "./views";

const CONFETTI = ["#f2c94c", "#5e6ad2", "#34d399", "#f472b6", "#c9dcf5", "#f2994a"];

// ── Level up ──────────────────────────────────────────────────────────────────

export function buildLevelUp(actions: ViewActions): ViewHost {
  const badge = h("span", { class: "lvl-badge" });
  const name = h("span", { class: "lvl-name" });
  const text = h("div", { class: "lvl-text" });
  const row = h("div", { class: "actions" });
  const confetti = h("div", { class: "confetti" });
  const card = h("div", { class: "stack lvl-stack" }, h("div", { class: "lvl-head" }, badge, name), text, row);
  const el = h("div", { class: "view" }, h("div", { class: "card" }, confetti, card));

  let shown = 0;

  const done = () => {
    State.levelUp = null;
    actions.setView(State.defaultView());
  };

  return {
    el,
    sync() {
      const lvl = State.levelUp;
      if (!lvl || lvl.level === shown) return;
      shown = lvl.level;
      badge.textContent = `LEVEL ${lvl.level}`;
      name.textContent = lvl.name;
      clear(text);
      clear(row);
      if (lvl.unlock) {
        text.append("You unlocked ", h("b", { text: UNLOCK_TEXT[lvl.unlock] }));
      } else {
        text.textContent = "We're getting closer.";
      }

      const primary = (label: string, onclick: () => void) =>
        h("button", { class: "btn primary", text: label, onclick });
      switch (lvl.unlock) {
        case "hat":
        case "crown": {
          const wear = lvl.unlock;
          row.append(primary("Wear it", () => {
            actions.setWear(wear);
            done();
          }));
          break;
        }
        case "colours":
          row.append(primary("Pick a colour", () => {
            State.levelUp = null;
            actions.setView("bond");
          }));
          break;
        case "twirl":
          row.append(primary("Show me", () => actions.twirl()));
          break;
        default:
          row.append(primary("Yay", done));
      }
      row.append(h("button", { class: "btn secondary", text: lvl.unlock === "twirl" ? "Nice" : "Later", onclick: done }));

      // A one-off shower: each piece falls twice and stops, so nothing loops.
      clear(confetti);
      for (let i = 0; i < 16; i++) {
        const piece = h("i", {});
        piece.style.left = `${20 + Math.random() * 120}px`;
        piece.style.background = CONFETTI[i % CONFETTI.length];
        piece.style.animationDelay = `${Math.random() * 0.9}s`;
        confetti.append(piece);
      }
    },
  };
}

// ── Bond page ─────────────────────────────────────────────────────────────────

const LEGEND = "Chats +5 · Claude done +10 · Issue closed +15 · Petting +1";

export function buildBond(actions: ViewActions): ViewHost {
  const note = h("div", { class: "dim-note", text: LEGEND });
  const title = h("span", { class: "lin-title" });
  const days = h("span", { class: "dim-note" });
  const fill = h("i", {});
  const bar = h("div", { class: "bond-bar" }, fill);
  const progress = h("span", { class: "dim-note" });
  const levels = h("div", { class: "bond-levels" });
  const wearRow = h("div", { class: "bond-row" });
  const skinRow = h("div", { class: "bond-row" });
  const el = h("div", { class: "view" },
    h("div", { class: "card" },
      h("div", { class: "stack bond-stack" },
        h("div", { class: "lin-head" }, title, days),
        bar,
        progress,
        levels,
        wearRow,
        skinRow,
        note,
      )));

  let renderedKey = "";

  /**
   * One option. A locked one can still be tried on: it shows on the character
   * for a few seconds, with a note saying which level makes it stay.
   */
  function choice(
    icon: string,
    label: string,
    on: boolean,
    locked: string | null,
    pick: () => void,
    tryOn: () => void,
  ): HTMLElement {
    const b = h("button", {
      class: on ? "quick on" : "quick",
      text: locked ? `🔒 ${label}` : `${icon ? `${icon} ` : ""}${label}`,
    });
    if (locked) {
      b.title = `Try it on · yours at level ${locked}`;
      b.classList.add("locked");
      b.addEventListener("click", () => {
        tryOn();
        note.textContent = `Trying on ${label.toLowerCase()} · it's yours at level ${locked}`;
        window.setTimeout(() => {
          if (note.textContent?.startsWith(`Trying on ${label.toLowerCase()}`)) note.textContent = LEGEND;
        }, 4000);
      });
    } else {
      b.addEventListener("click", pick);
    }
    return b;
  }

  const lockLevel = (unlock: "hat" | "crown" | "colours") =>
    has(unlock) ? null : String(LEVELS.find((l) => l.unlock === unlock)?.level ?? "");

  return {
    el,
    sync() {
      const b = bond();
      const key = JSON.stringify([b.points, b.wear, b.skin, State.settings.personality]);
      if (key === renderedKey) return;
      renderedKey = key;

      const lvl = levelFor(b.points);
      const next = nextLevel(b.points);
      title.textContent = `${activeLook().name} · Level ${lvl.level} · ${lvl.name}`;
      const d = daysTogether();
      days.textContent = `together ${d} day${d === 1 ? "" : "s"}`;
      const span = next ? next.at - lvl.at : 1;
      fill.style.width = `${next ? Math.round(((b.points - lvl.at) / span) * 100) : 100}%`;
      progress.textContent = next
        ? `${b.points} / ${next.at} to level ${next.level} · ${next.name}`
        : `${b.points} points · the highest level. Legends forever.`;

      clear(levels);
      for (const l of LEVELS) {
        const state = b.points >= l.at ? "done" : l === next ? "next" : "";
        const lv = h("div", { class: `bond-lv ${state}` },
          h("b", { text: String(l.level) }),
          h("span", { text: l.name }),
          l.unlock ? h("span", { class: "u", text: UNLOCK_SHORT[l.unlock] }) : null);
        // The move can be previewed too: click "Pals" to see the twirl.
        if (l.unlock === "twirl") {
          lv.classList.add("tryable");
          lv.title = has("twirl") ? "Double-click me to twirl" : "Click to see the twirl";
          lv.addEventListener("click", () => actions.twirl());
        }
        levels.append(lv);
      }

      clear(wearRow);
      wearRow.append(
        h("span", { class: "bond-label", text: "Wear" }),
        choice("", "Nothing", !b.wear, null, () => actions.setWear(null), () => {}),
        choice("🎉", "Party hat", b.wear === "hat", lockLevel("hat"),
          () => actions.setWear("hat"), () => actions.tryOn({ wear: "hat" })),
        choice("👑", "Crown", b.wear === "crown", lockLevel("crown"),
          () => actions.setWear("crown"), () => actions.tryOn({ wear: "crown" })),
      );
      clear(skinRow);
      const colourLock = lockLevel("colours");
      skinRow.append(
        h("span", { class: "bond-label", text: "Colour" }),
        choice("", "Original", !b.skin, null, () => actions.setSkin(null), () => {}),
        ...(["mint", "lemon", "lilac"] as const).map((skin) =>
          choice("", skin[0].toUpperCase() + skin.slice(1), b.skin === skin, colourLock,
            () => actions.setSkin(skin), () => actions.tryOn({ skin }))),
      );
    },
  };
}
