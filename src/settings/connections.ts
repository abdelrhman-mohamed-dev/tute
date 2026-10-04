// Claude Code and Linear: each is one button that connects or disconnects,
// a line saying where things stand, and a result line after a click.

import { ClaudeBridge, LinearBridge, onEvent, type ClaudeHooksStatus, type LinearStatus } from "../core/bridge";
import { h } from "../views/kit";
import { hint, panel, resultLine, row } from "./form";

/** What a connection looks like right now. */
interface Look {
  connected: boolean;
  /** The button's label while not connected (e.g. "Waiting for the browser…"). */
  connectLabel?: string;
  status: string;
}

/**
 * One connection: a panel with a Connect / Disconnect button. `toggle` does
 * the work and returns a message for the result line (or nothing).
 */
function connection(title: string, what: string, toggle: (connected: boolean) => Promise<string | void>) {
  const button = h("button");
  const status = hint("");
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
    el: panel(title, row(what, button, status), result.el),
    show(look: Look | null) {
      connected = look?.connected ?? false;
      button.textContent = connected ? "Disconnect" : look?.connectLabel ?? "Connect";
      button.className = connected ? "danger" : "primary";
      status.textContent = look?.status ?? "Only works inside the Tute app.";
    },
  };
}

/** Tute's hooks in ~/.claude/settings.json: sessions show on the island. */
export function claudePanel(): HTMLElement {
  const look = (s: ClaudeHooksStatus | null): Look | null =>
    s && {
      connected: s.installed,
      status: !s.listening
        ? `Port ${s.port} is taken by another program, so sessions can't reach Tute.`
        : s.installed
          ? "Connected. New Claude Code sessions show up on the island."
          : "Shows your Claude Code sessions on the island and tells you when one needs you or finishes.",
    };

  const c = connection("Claude Code", "Sessions", async (connected) => {
    const s = connected ? await ClaudeBridge.remove() : await ClaudeBridge.install();
    c.show(look(s));
    return s.installed
      ? `Hooks added to ${s.settingsPath}. Sessions already open pick them up after a restart.`
      : `Hooks removed from ${s.settingsPath}.`;
  });

  const refresh = async () => c.show(look(await ClaudeBridge.status()));
  void refresh();
  window.addEventListener("focus", () => void refresh());
  return c.el;
}

/** Linear, approved in the browser like any MCP client; the tokens never leave Rust. */
export function linearPanel(): HTMLElement {
  const look = (s: LinearStatus | null): Look | null =>
    s && {
      connected: s.connected,
      connectLabel: s.signingIn ? "Waiting for the browser…" : undefined,
      status: s.connected
        ? `Connected${s.user ? ` as ${s.user}` : ""}.`
        : s.signingIn
          ? "Approve Tute on Linear's page, then come back here."
          : "Opens Linear in your browser to approve Tute, like Claude does. Nothing to set up.",
    };

  // The answer comes back as `linear-changed`, which updates the panel.
  const c = connection("Linear", "Workspace", (connected) => (connected ? LinearBridge.disconnect() : LinearBridge.connect()));
  void LinearBridge.status().then((s) => c.show(look(s)));
  void onEvent<LinearStatus>("linear-changed", (s) => c.show(look(s)));
  return c.el;
}
