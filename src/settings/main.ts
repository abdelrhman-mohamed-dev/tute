// The settings window: AI models, general preferences, Claude Code, Linear.
// It reads the settings at boot, saves on every change, and follows changes
// made from the island (another model, the other buddy).

import "./settings.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h } from "../views/kit";
import { claudePanel, linearPanel } from "./connections";
import { generalPanel, type SettingsHost } from "./general";
import { modelsPanel } from "./models";

const PRIVACY =
  "No telemetry. Tute only connects to the AI providers you add here, and only when you use them. " +
  "Claude Code talks to Tute on this PC only (127.0.0.1). Linear, once you connect it, is reached only for what you ask Tute to do.";

async function main() {
  const boot = await Bridge.boot();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...boot?.settings };
  const host: SettingsHost = {
    settings: () => settings,
    save: async () => {
      await Bridge.saveSettings(settings);
    },
  };

  const models = modelsPanel(host);
  const general = generalPanel(host);
  document.getElementById("settings-root")!.replaceChildren(
    h("h1", {}, h("span", { text: "Tute" }), h("span", { class: "version", text: boot?.version ?? "" })),
    models,
    general.el,
    claudePanel(),
    linearPanel(),
    h("div", { class: "hint", text: PRIVACY }),
  );

  // Changes from the island. The models panel only redraws when the active
  // model really changed, so our own saves don't wipe a half-typed form.
  let active = JSON.stringify(settings.activeModel);
  void onEvent<Settings>("settings-changed", (next) => {
    settings = { ...settings, ...next };
    general.sync();
    const now = JSON.stringify(settings.activeModel);
    if (now !== active) {
      active = now;
      models.refresh();
    }
  });
}

void main();
