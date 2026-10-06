// About: the version, what Tute keeps to itself, and where its files are.

import { ICONS } from "../views/icons";
import { h } from "../views/kit";
import { group, item, type Page } from "./form";

const PROMISES: [string, string][] = [
  ["No telemetry", "Tute never reports anything about you or how you use it."],
  ["Only what you connect", "It talks to the AI providers you add, Linear if you connect it, and nothing else."],
  ["Claude Code stays local", "Sessions report to Tute on this PC only (127.0.0.1)."],
  ["Browsing stays yours", "The extension only talks to Tute on this PC. Pages are read with your chosen model, nothing else."],
  ["Keys stay safe", "API keys and sign-ins live in the Windows Credential Manager."],
];

const FILES: [string, string][] = [
  ["Settings", "%APPDATA%\\Tute\\settings.json"],
  ["Dropped files", "%LOCALAPPDATA%\\Tute\\inbox (cleared after a week)"],
  ["Saved chats", "%APPDATA%\\Tute\\chats"],
  ["Memory", "%APPDATA%\\Tute\\memory.json"],
  ["Log", "%LOCALAPPDATA%\\Tute\\tute.log"],
];

export function aboutPage(version: string): Page {
  return {
    id: "about",
    title: "About",
    lead: "A little jelly that keeps you company at the top of your screen.",
    icon: ICONS.info,
    lines: true,
    el: h(
      "div",
      {},
      group(null, item("Tute", "Made in code: the jelly, its sounds and its icons.", h("span", { class: "version", text: version ? `v${version}` : "" }))),
      group("Privacy", ...PROMISES.map(([title, about]) => item(title, about))),
      group("Where things are", ...FILES.map(([title, path]) => item(title, h("span", { class: "path", text: path })))),
    ),
  };
}
