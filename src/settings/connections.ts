// Connections: Claude Code and Linear, each with where it stands and one
// button; plus what happens when Claude finishes a Linear issue.

import {
  BrowseBridge, ClaudeBridge, LinearBridge, ObsidianBridge, onEvent, type ClaudeHooksStatus, type LinearStatus, type ObsidianVault,
} from "../core/bridge";
import type { Settings } from "../core/state";
import { ICONS } from "../views/icons";
import { h } from "../views/kit";
import { group, item, onOff, resultLine, status, type Page, type SettingsHost } from "./form";

/** How a connection stands right now. */
interface Standing {
  connected: boolean;
  /** The status line under its name. */
  line: HTMLElement;
  /** The button's label while not connected. */
  connectLabel?: string;
}

const OUTSIDE = (): Standing => ({ connected: false, line: status("off", "Only works inside the Tute app.") });

/** One connection: name, status line, Connect / Disconnect. `toggle` returns a message for the result line. */
function connection(name: string, toggle: (connected: boolean) => Promise<string | void>) {
  const button = h("button");
  const line = h("span");
  const result = resultLine();
  let connected = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    result.clear();
    try {
      const message = await toggle(connected);
      if (message) result.ok(message);
    } catch (err) {
      result.fail(err);
    } finally {
      button.disabled = false;
    }
  });
  return {
    el: h("div", {}, item(name, line, button), result.el),
    show(s: Standing) {
      connected = s.connected;
      line.replaceChildren(s.line);
      button.textContent = connected ? "Disconnect" : s.connectLabel ?? "Connect";
      button.className = connected ? "quiet" : "primary";
    },
  };
}

function claude() {
  const standing = (s: ClaudeHooksStatus | null): Standing => {
    if (!s) return OUTSIDE();
    if (!s.listening) return { connected: s.installed, line: status("bad", `Port ${s.port} is taken by another program, so sessions can't reach Tute.`) };
    return s.installed
      ? { connected: true, line: status("on", "Connected. New sessions show up on the island.") }
      : { connected: false, line: status("off", "Shows your sessions on the island, and lets you answer them there.") };
  };
  const c = connection("Claude Code", async (connected) => {
    const s = connected ? await ClaudeBridge.remove() : await ClaudeBridge.install();
    c.show(standing(s));
    return s.installed
      ? `Added to ${s.settingsPath}. Sessions already open join after a restart.`
      : `Removed from ${s.settingsPath}.`;
  });
  const refresh = async () => c.show(standing(await ClaudeBridge.status()));
  void refresh();
  window.addEventListener("focus", () => void refresh());
  return c.el;
}

function linear() {
  const standing = (s: LinearStatus | null): Standing => {
    if (!s) return OUTSIDE();
    if (s.connected) return { connected: true, line: status("on", `Connected${s.user ? ` as ${s.user}` : ""}.`) };
    if (s.signingIn) return { connected: false, connectLabel: "Waiting…", line: status("wait", "Approve Tute on Linear's page, then come back.") };
    return { connected: false, line: status("off", "Your issues on the island. Approve it in the browser; no keys to copy.") };
  };
  // The answer arrives as `linear-changed`.
  const c = connection("Linear", (connected) => (connected ? LinearBridge.disconnect() : LinearBridge.connect()));
  void LinearBridge.status().then((s) => c.show(standing(s)));
  void onEvent<LinearStatus>("linear-changed", (s) => c.show(standing(s)));
  return c.el;
}

/**
 * Obsidian: the vault Tute writes to. The ones Obsidian already knows are
 * offered; any other folder can be picked (it must be a vault).
 */
function obsidian(host: SettingsHost): { el: HTMLElement; sync(): void } {
  const line = h("span");
  const controls = h("span", { class: "item-control" });
  const result = resultLine();
  let known: ObsidianVault[] = [];

  const use = (vault: ObsidianVault) => {
    host.settings().obsidianVault = vault.path;
    void host.save();
    result.ok(`Connected to “${vault.name}”. Jot into today's note from the island.`);
    sync();
  };
  const pickFolder = async () => {
    result.clear();
    try {
      const vault = await ObsidianBridge.pick();
      if (vault) use(vault);
    } catch (err) {
      result.fail(err);
    }
  };

  function sync() {
    const path = host.settings().obsidianVault;
    if (path) {
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      line.replaceChildren(status("on", `Vault “${name}”`), h("span", { class: "path", text: `  ${path}` }));
      controls.replaceChildren(
        h("button", { class: "quiet", text: "Change…", onclick: () => void pickFolder() }),
        h("button", {
          class: "quiet",
          text: "Disconnect",
          onclick: () => {
            host.settings().obsidianVault = null;
            void host.save();
            result.clear();
            sync();
          },
        }),
      );
      return;
    }
    line.replaceChildren(
      status("off", known.length ? "Pick the vault Tute writes to. No plugin needed." : "Choose your vault's folder. No plugin needed."),
    );
    const folder = h("button", { class: known.length ? "quiet" : "primary", text: "Folder…", onclick: () => void pickFolder() });
    if (!known.length) {
      controls.replaceChildren(folder);
      return;
    }
    const pick = h("select", {}, ...known.map((v, i) => h("option", { value: String(i), text: v.name, title: v.path })));
    controls.replaceChildren(pick, h("button", { class: "primary", text: "Connect", onclick: () => use(known[Number(pick.value)]) }), folder);
  }

  // Obsidian's own list of vaults, refreshed whenever the window comes back.
  const load = async () => {
    known = (await ObsidianBridge.vaults()) ?? [];
    sync();
  };
  void load();
  window.addEventListener("focus", () => void load());

  const row = item("Obsidian", line);
  row.querySelector(".item-control")?.replaceWith(controls);
  return { el: h("div", {}, row, result.el), sync };
}

/**
 * The browser: Tute's extension for Edge or Chrome. "Set up" writes it (with
 * this PC's token) and opens its folder; you load it once as unpacked.
 */
function browser(): HTMLElement {
  const line = h("span");
  const button = h("button");
  const result = resultLine();

  const show = async () => {
    const s = await BrowseBridge.status();
    if (!s) {
      line.replaceChildren(status("off", "Only works inside the Tute app."));
      button.textContent = "Set up…";
      button.className = "primary";
      return;
    }
    line.replaceChildren(
      s.connected
        ? status("on", "Connected. Ask in the chat: I look things up when a question needs it.")
        : s.folder
          ? status("wait", "Waiting for the extension. Load it in your browser, and keep the browser open.")
          : status("off", "Browses and reads the web for you in your own Edge or Chrome."),
    );
    button.textContent = s.folder ? "Set up again…" : "Set up…";
    button.className = s.connected ? "quiet" : "primary";
  };

  button.addEventListener("click", async () => {
    result.clear();
    try {
      const folder = await BrowseBridge.setup();
      result.ok(
        `Its folder is open: ${folder}. In Edge or Chrome, open edge://extensions (or chrome://extensions), turn on Developer mode, choose "Load unpacked" and pick that folder.`,
      );
    } catch (err) {
      result.fail(err);
    }
    void show();
  });

  void show();
  window.addEventListener("focus", () => void show());
  // While it's waiting, check now and then, so "Connected" shows by itself.
  window.setInterval(() => {
    if (document.visibilityState === "visible" && line.isConnected) void show();
  }, 4000);
  return h("div", {}, item("Browser", line, button), result.el);
}

export function connectionsPage(host: SettingsHost): Page {
  const vault = obsidian(host);
  const s = host.settings();
  const set = (change: (s: Settings) => void) => {
    change(host.settings());
    void host.save();
  };
  const comment = onOff(s.claudeDoneComment, (on) => set((s) => (s.claudeDoneComment = on)));
  const review = onOff(s.claudeDoneReview, (on) => set((s) => (s.claudeDoneReview = on)));

  return {
    id: "connections",
    title: "Connections",
    lead: "The tools Tute works with. It only talks to the ones you connect.",
    icon: ICONS.link,
    lines: true,
    el: h(
      "div",
      {},
      group(null, claude(), linear(), vault.el, browser()),
      group(
        "When Claude finishes a Linear issue",
        item("Post a summary", "Claude's last reply goes on the issue as a comment.", comment),
        item("Move it to review", "The issue moves to your team's review status, if it has one.", review),
      ),
    ),
    sync() {
      vault.sync();
      const now = host.settings();
      comment.classList.toggle("on", now.claudeDoneComment);
      review.classList.toggle("on", now.claudeDoneReview);
    },
  };
}
