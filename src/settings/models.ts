// AI models: the providers you add (a name, a protocol, a link, a key), the
// models of each, which one the chat uses, and a Test button.
//
// Keys go to the Windows Credential Manager through Rust and never come back:
// the page only ever learns whether one is stored. The rest (providers,
// models, the active choice) is saved with the other settings.

import { Bridge } from "../core/bridge";
import type { ActiveModel, Provider, ProviderKind, Settings } from "../core/state";
import { h } from "../views/kit";
import { errorText, hint, panel, resultLine, row, topRow } from "./form";
import type { SettingsHost } from "./general";

/** A ready-made provider for the "Add a provider" menu. */
interface Preset {
  label: string;
  name: string;
  kind: ProviderKind;
  link: string;
  /** Models added right away; others come from "Fetch models" or typing. */
  models: string[];
  keyHint: string;
  noKey?: boolean;
}

const PRESETS: Preset[] = [
  { label: "OpenAI", name: "OpenAI", kind: "openAi", link: "https://api.openai.com/v1", models: [], keyHint: "sk-…" },
  { label: "Anthropic (Claude)", name: "Anthropic", kind: "anthropic", link: "https://api.anthropic.com", models: ["claude-opus-5-5"], keyHint: "sk-ant-…" },
  { label: "GLM — Z.ai", name: "GLM (Z.ai)", kind: "openAi", link: "https://api.z.ai/api/paas/v4", models: [], keyHint: "API key" },
  { label: "GLM — BigModel (China)", name: "GLM (BigModel)", kind: "openAi", link: "https://open.bigmodel.cn/api/paas/v4", models: [], keyHint: "API key" },
  { label: "Ollama (this PC)", name: "Ollama", kind: "openAi", link: "http://localhost:11434/v1", models: [], keyHint: "not needed", noKey: true },
  { label: "Other (OpenAI-compatible)", name: "", kind: "openAi", link: "", models: [], keyHint: "API key" },
];

const PROTOCOL: Record<ProviderKind, string> = { openAi: "OpenAI-compatible", anthropic: "Anthropic" };

const freshId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const asValue = (m: ActiveModel) => JSON.stringify({ providerId: m.providerId, model: m.model });

const grow = (basis: number) => `flex:1 1 ${basis}px;min-width:0`;

/** The panel. It redraws itself after each change; `refresh()` redraws for a change made elsewhere. */
export function modelsPanel(host: SettingsHost): HTMLElement & { refresh(): void } {
  const el = h("section");
  /** Kept across redraws: the last Test result, and the models fetched per provider. */
  let tested: HTMLElement | null = null;
  const fetched = new Map<string, string[]>();

  const s = () => host.settings();
  const saveAndRedraw = () => void host.save().then(redraw);

  async function redraw() {
    const keys = new Map<string, boolean>();
    for (const p of s().providers) keys.set(p.id, (await Bridge.providerKeyPresent(p.id)) ?? false);
    const fresh = panel(
      "AI models",
      hint("Add a provider, add its models, and pick the one Tute uses. Keys are stored in the Windows Credential Manager, never on disk."),
      activeModel(),
      ...s().providers.map((p) => providerCard(p, keys.get(p.id) ?? false)),
      newProvider(),
    );
    el.replaceChildren(...fresh.childNodes);
  }

  /** Which model the chat uses, and a Test button for it. */
  function activeModel(): HTMLElement {
    const settings = s();
    const pick = h("select", { style: "min-width:260px" });
    pick.append(h("option", { value: "", text: settings.providers.length ? "Choose a model…" : "Add a provider first" }));
    for (const p of settings.providers) {
      for (const model of p.models) pick.append(h("option", { value: asValue({ providerId: p.id, model }), text: `${p.name} · ${model}` }));
    }
    pick.value = settings.activeModel ? asValue(settings.activeModel) : "";
    pick.addEventListener("change", () => {
      settings.activeModel = pick.value ? (JSON.parse(pick.value) as ActiveModel) : null;
      tested = null;
      saveAndRedraw();
    });

    const test = h("button", { class: "primary", text: "Test" });
    test.disabled = !settings.activeModel;
    test.addEventListener("click", async () => {
      const active = s().activeModel;
      if (!active) return;
      test.disabled = true;
      test.textContent = "Testing…";
      try {
        const r = await Bridge.aiTest(active.providerId, active.model);
        tested = h("div", { class: "notice ok", text: `“${r.reply}” · ${(r.millis / 1000).toFixed(1)} s` });
      } catch (err) {
        tested = h("div", { class: "notice err", text: errorText(err) });
      }
      void redraw();
    });

    return h("div", { style: "display:flex;flex-direction:column;gap:8px" }, row("Active model", pick, test), tested);
  }

  /** One provider: its key, its models, adding more. */
  function providerCard(p: Provider, hasKey: boolean): HTMLElement {
    const result = resultLine();

    const key = h("input", {
      type: "password",
      placeholder: hasKey ? "••••••••  (stored)" : "API key",
      autocomplete: "off",
      spellcheck: "false",
      style: grow(220),
    });
    const saveKey = h("button", { text: hasKey ? "Replace key" : "Save key" });
    saveKey.addEventListener("click", async () => {
      if (!key.value.trim()) return;
      try {
        await Bridge.providerKeySet(p.id, key.value.trim());
        void redraw();
      } catch (err) {
        result.fail(`Couldn't save the key: ${errorText(err)}`);
      }
    });
    const dropKey = hasKey ? h("button", { class: "danger", text: "Remove key" }) : null;
    dropKey?.addEventListener("click", async () => {
      await Bridge.providerKeyClear(p.id);
      void redraw();
    });

    const addModel = (name: string) => {
      const model = name.trim();
      if (!model || p.models.includes(model)) return;
      p.models = [...p.models, model];
      // The first model anywhere becomes the active one, so Test works right away.
      s().activeModel ??= { providerId: p.id, model };
      saveAndRedraw();
    };
    const removeModel = (model: string) => {
      p.models = p.models.filter((m) => m !== model);
      const active = s().activeModel;
      if (active?.providerId === p.id && active.model === model) s().activeModel = null;
      saveAndRedraw();
    };
    const chips = h(
      "div",
      { class: "chips" },
      ...p.models.map((m) =>
        h("span", { class: "chip" }, h("span", { text: m }),
          h("button", { class: "chip-x", title: `Remove ${m}`, text: "×", onclick: () => removeModel(m) })),
      ),
    );
    if (!p.models.length) chips.append(hint("No models yet."));

    const typed = h("input", { type: "text", placeholder: "model name, e.g. glm-…", spellcheck: "false", style: grow(200) });
    typed.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addModel(typed.value);
    });
    const fetch = h("button", { text: "Fetch models" });
    fetch.addEventListener("click", async () => {
      fetch.disabled = true;
      fetch.textContent = "Fetching…";
      try {
        fetched.set(p.id, await Bridge.aiListModels(p.id));
        void redraw();
      } catch (err) {
        fetch.disabled = false;
        fetch.textContent = "Fetch models";
        result.fail(err);
      }
    });

    const card = h(
      "div",
      { class: "provider" },
      h("div", { class: "provider-head" },
        h("span", { class: "provider-name", text: p.name }),
        h("span", { class: "tag", text: PROTOCOL[p.kind] }),
        h("span", { class: "path", text: p.baseUrl }),
        h("span", { class: "spacer" }),
        removeProvider(p),
      ),
      row("API key", h("i", { class: "dot", style: `background:var(${hasKey ? "--ok" : "--danger"})` }), key, saveKey, dropKey),
      topRow("Models", chips),
      row("", typed, h("button", { text: "Add model", onclick: () => addModel(typed.value) }), fetch),
    );

    // After a fetch: a menu of the models not added yet.
    const more = fetched.get(p.id)?.filter((m) => !p.models.includes(m));
    if (more) {
      const pick = h("select", { style: grow(220) },
        h("option", { value: "", text: more.length ? `${more.length} more available…` : "All fetched models are added" }),
        ...more.map((m) => h("option", { value: m, text: m })));
      card.append(row("", pick, h("button", { text: "Add", onclick: () => addModel(pick.value) })));
    }
    card.append(result.el);
    return card;
  }

  /** Remove takes two clicks: it deletes the stored key too. */
  function removeProvider(p: Provider): HTMLElement {
    const button = h("button", { class: "danger", text: "Remove" });
    let sure = false;
    button.addEventListener("click", async () => {
      if (!sure) {
        sure = true;
        button.textContent = "Click again to remove";
        window.setTimeout(() => {
          sure = false;
          button.textContent = "Remove";
        }, 3000);
        return;
      }
      await Bridge.providerKeyClear(p.id);
      const settings = s();
      settings.providers = settings.providers.filter((x) => x.id !== p.id);
      if (settings.activeModel?.providerId === p.id) settings.activeModel = null;
      fetched.delete(p.id);
      saveAndRedraw();
    });
    return button;
  }

  /** The dashed card at the bottom: pick a preset (or fill it in), add the key. */
  function newProvider(): HTMLElement {
    const preset = h("select", {}, ...PRESETS.map((pr, i) => h("option", { value: String(i), text: pr.label })));
    const kind = h("select", {},
      h("option", { value: "openAi", text: PROTOCOL.openAi }),
      h("option", { value: "anthropic", text: PROTOCOL.anthropic }));
    const name = h("input", { type: "text", placeholder: "Name", style: grow(160) });
    const link = h("input", { type: "text", placeholder: "https://…", spellcheck: "false", style: grow(260) });
    const key = h("input", { type: "password", autocomplete: "off", spellcheck: "false", style: grow(220) });
    const result = resultLine();
    const chosen = () => PRESETS[Number(preset.value)];

    const fillIn = () => {
      kind.value = chosen().kind;
      name.value = chosen().name;
      link.value = chosen().link;
      key.placeholder = chosen().keyHint;
    };
    preset.addEventListener("change", fillIn);
    fillIn();

    const add = h("button", { class: "primary", text: "Add provider" });
    add.addEventListener("click", async () => {
      result.clear();
      const pr = chosen();
      const baseUrl = link.value.trim();
      const secret = key.value.trim();
      if (!baseUrl) return result.fail("Enter the provider's link.");
      if (!secret && !pr.noKey) return result.fail("Enter the API key.");
      try {
        await Bridge.checkProviderUrl(baseUrl);
      } catch (err) {
        return result.fail(err);
      }
      add.disabled = true;
      const provider: Provider = {
        id: freshId(),
        name: name.value.trim() || pr.label,
        kind: kind.value as ProviderKind,
        baseUrl,
        models: [...pr.models],
      };
      try {
        if (secret) await Bridge.providerKeySet(provider.id, secret);
      } catch (err) {
        add.disabled = false;
        return result.fail(`Couldn't save the key: ${errorText(err)}`);
      }
      const settings: Settings = s();
      settings.providers = [...settings.providers, provider];
      if (!settings.activeModel && provider.models.length) {
        settings.activeModel = { providerId: provider.id, model: provider.models[0] };
      }
      saveAndRedraw();
    });

    return h(
      "div",
      { class: "provider add" },
      h("div", { class: "provider-head" }, h("span", { class: "provider-name", text: "Add a provider" })),
      row("Provider", preset),
      row("Name", name, kind),
      row("Link", link),
      row("API key", key),
      row("", add),
      result.el,
    );
  }

  void redraw();
  return Object.assign(el, { refresh: () => void redraw() });
}
