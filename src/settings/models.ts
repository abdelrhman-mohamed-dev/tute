// Chat models: which model the chat uses, and the providers behind it. Each
// provider folds into one line (protocol, how many models, key or not) and
// opens to its key and models; a new one is added from a form that only
// shows when asked for.
//
// Keys go to the Windows Credential Manager through Rust and never come back:
// the page only learns whether one is stored.

import { Bridge } from "../core/bridge";
import type { ActiveModel, Provider, ProviderKind } from "../core/state";
import { ICONS } from "../views/icons";
import { h, svg } from "../views/kit";
import { errorText, group, item, resultLine, status, type Page, type SettingsHost } from "./form";

/** A ready-made provider for the add form. */
interface Preset {
  label: string;
  name: string;
  kind: ProviderKind;
  link: string;
  /** Models added right away; others come from "Find models" or typing. */
  models: string[];
  keyHint: string;
  noKey?: boolean;
}

const PRESETS: Preset[] = [
  { label: "Anthropic (Claude)", name: "Anthropic", kind: "anthropic", link: "https://api.anthropic.com", models: ["claude-opus-5-5"], keyHint: "sk-ant-…" },
  { label: "OpenAI", name: "OpenAI", kind: "openAi", link: "https://api.openai.com/v1", models: [], keyHint: "sk-…" },
  { label: "GLM — Z.ai", name: "GLM (Z.ai)", kind: "openAi", link: "https://api.z.ai/api/paas/v4", models: [], keyHint: "API key" },
  { label: "GLM — BigModel (China)", name: "GLM (BigModel)", kind: "openAi", link: "https://open.bigmodel.cn/api/paas/v4", models: [], keyHint: "API key" },
  { label: "Ollama (on this PC)", name: "Ollama", kind: "openAi", link: "http://localhost:11434/v1", models: [], keyHint: "not needed", noKey: true },
  { label: "Something else (OpenAI-compatible)", name: "", kind: "openAi", link: "", models: [], keyHint: "API key" },
];

const PROTOCOL: Record<ProviderKind, string> = { openAi: "OpenAI-compatible", anthropic: "Anthropic" };

const freshId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const asValue = (m: ActiveModel) => JSON.stringify({ providerId: m.providerId, model: m.model });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function modelsPage(host: SettingsHost): Page & { refresh(): void } {
  const el = h("div");
  // Kept across redraws: the last test, the providers opened, the models found, the add form.
  let tested: HTMLElement | null = null;
  const open = new Set<string>();
  const found = new Map<string, string[]>();
  let adding = false;

  const s = () => host.settings();
  const saveAndRedraw = () => void host.save().then(redraw);

  async function redraw() {
    const keys = new Map<string, boolean>();
    for (const p of s().providers) keys.set(p.id, (await Bridge.providerKeyPresent(p.id)) ?? false);
    const providers = s().providers;
    el.replaceChildren(
      group("The chat uses", activeModel(), tested),
      group(
        "Providers",
        ...(providers.length
          ? providers.map((p) => provider(p, keys.get(p.id) ?? false))
          : [h("div", { class: "empty", text: "No providers yet. Add one, and Tute can chat with you." })]),
        adding ? newProvider() : h("button", { class: "add-row", onclick: () => ((adding = true), void redraw()) }, svg(ICONS.plus, 12), "Add a provider"),
      ),
      h("p", { class: "footnote", text: "Keys are kept in the Windows Credential Manager, never in a file, and only sent to the provider they belong to." }),
    );
  }

  /** The chat's model, and a Test button for it. */
  function activeModel(): HTMLElement {
    const settings = s();
    const all = settings.providers.flatMap((p) => p.models.map((model) => ({ p, model })));
    const pick = h(
      "select",
      { class: "wide" },
      h("option", { value: "", text: all.length ? "Choose a model…" : "Add a provider first" }),
      ...all.map(({ p, model }) => h("option", { value: asValue({ providerId: p.id, model }), text: `${model} · ${p.name}` })),
    );
    pick.value = settings.activeModel ? asValue(settings.activeModel) : "";
    pick.disabled = !all.length;
    pick.addEventListener("change", () => {
      settings.activeModel = pick.value ? (JSON.parse(pick.value) as ActiveModel) : null;
      tested = null;
      saveAndRedraw();
    });

    const test = h("button", { text: "Test" });
    test.disabled = !settings.activeModel;
    test.addEventListener("click", async () => {
      const active = s().activeModel;
      if (!active) return;
      test.disabled = true;
      test.textContent = "Testing…";
      try {
        const r = await Bridge.aiTest(active.providerId, active.model);
        tested = h("div", { class: "notice ok", text: `It answered in ${(r.millis / 1000).toFixed(1)} s: “${r.reply}”` });
      } catch (err) {
        tested = h("div", { class: "notice err", text: errorText(err) });
      }
      void redraw();
    });
    return item("Model", "Also changeable from the island's chat.", pick, test);
  }

  /** One provider: a line, and its details when opened. */
  function provider(p: Provider, hasKey: boolean): HTMLElement {
    const isOpen = open.has(p.id);
    const toggle = h(
      "button",
      {
        class: `fold${isOpen ? " open" : ""}`,
        title: isOpen ? "Close" : "Open",
        onclick: () => {
          if (isOpen) open.delete(p.id);
          else open.add(p.id);
          void redraw();
        },
      },
      svg(ICONS.chevronRight, 12, { stroke: 2.4 }),
    );
    const keyStatus = hasKey ? status("on", "key saved") : p.baseUrl.includes("localhost") ? status("off", "no key needed") : status("bad", "no key");
    const summary = h("span", {}, `${PROTOCOL[p.kind]} · ${plural(p.models.length, "model")} · `, keyStatus);
    const line = item(p.name, summary, toggle);
    line.classList.add("clickable");
    line.addEventListener("click", (e) => {
      if (e.target === line || (e.target as HTMLElement).closest(".item-text")) toggle.click();
    });
    return h("div", { class: `provider${isOpen ? " open" : ""}` }, line, isOpen ? details(p, hasKey) : null);
  }

  function details(p: Provider, hasKey: boolean): HTMLElement {
    const result = resultLine();

    const key = h("input", { type: "password", placeholder: hasKey ? "••••••••  (saved)" : "Paste the API key", autocomplete: "off", spellcheck: "false" });
    const saveKey = h("button", { text: hasKey ? "Replace" : "Save" });
    saveKey.addEventListener("click", async () => {
      if (!key.value.trim()) return;
      try {
        await Bridge.providerKeySet(p.id, key.value.trim());
        void redraw();
      } catch (err) {
        result.fail(`Couldn't save the key: ${errorText(err)}`);
      }
    });
    const dropKey = hasKey
      ? h("button", { class: "quiet", text: "Remove", onclick: async () => (await Bridge.providerKeyClear(p.id), void redraw()) })
      : null;

    const addModel = (name: string) => {
      const model = name.trim();
      if (!model || p.models.includes(model)) return;
      p.models = [...p.models, model];
      // The first model anywhere becomes the chat's, so Test works right away.
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
        h("span", { class: "chip" }, m, h("button", { class: "chip-x", title: `Remove ${m}`, text: "×", onclick: () => removeModel(m) })),
      ),
    );
    if (!p.models.length) chips.append(h("span", { class: "item-about", text: "None yet. Type one below, or find them." }));

    const typed = h("input", { type: "text", placeholder: "Model name", spellcheck: "false" });
    typed.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addModel(typed.value);
    });
    const find = h("button", { text: "Find models" });
    find.addEventListener("click", async () => {
      find.disabled = true;
      find.textContent = "Looking…";
      try {
        found.set(p.id, await Bridge.aiListModels(p.id));
        void redraw();
      } catch (err) {
        find.disabled = false;
        find.textContent = "Find models";
        result.fail(err);
      }
    });
    const more = found.get(p.id)?.filter((m) => !p.models.includes(m));
    const offered = more
      ? h(
          "select",
          { onchange: (e: Event) => addModel((e.target as HTMLSelectElement).value) },
          h("option", { value: "", text: more.length ? `Add one of ${more.length} more…` : "All of them are added" }),
          ...more.map((m) => h("option", { value: m, text: m })),
        )
      : null;

    return h(
      "div",
      { class: "details" },
      h("div", { class: "field" }, h("label", { text: "API key" }), h("div", { class: "line" }, key, saveKey, dropKey)),
      h("div", { class: "field" }, h("label", { text: "Models" }), chips),
      h("div", { class: "field" }, h("label"), h("div", { class: "line" }, typed, h("button", { text: "Add", onclick: () => addModel(typed.value) }), find)),
      offered && h("div", { class: "field" }, h("label"), h("div", { class: "line" }, offered)),
      h("div", { class: "field" }, h("label", { text: "Link" }), h("span", { class: "path", text: p.baseUrl })),
      h("div", { class: "field" }, h("label"), h("div", { class: "line" }, removeProvider(p))),
      result.el,
    );
  }

  /** Remove takes two clicks: it deletes the saved key too. */
  function removeProvider(p: Provider): HTMLElement {
    const button = h("button", { class: "danger", text: "Remove provider" });
    let sure = false;
    button.addEventListener("click", async () => {
      if (!sure) {
        sure = true;
        button.textContent = "Click again to remove";
        window.setTimeout(() => {
          sure = false;
          button.textContent = "Remove provider";
        }, 3000);
        return;
      }
      await Bridge.providerKeyClear(p.id);
      const settings = s();
      settings.providers = settings.providers.filter((x) => x.id !== p.id);
      if (settings.activeModel?.providerId === p.id) settings.activeModel = null;
      open.delete(p.id);
      found.delete(p.id);
      saveAndRedraw();
    });
    return button;
  }

  /** The add form: pick a preset (or fill it in), paste the key. */
  function newProvider(): HTMLElement {
    const preset = h("select", {}, ...PRESETS.map((pr, i) => h("option", { value: String(i), text: pr.label })));
    const kind = h("select", {}, h("option", { value: "openAi", text: PROTOCOL.openAi }), h("option", { value: "anthropic", text: PROTOCOL.anthropic }));
    const name = h("input", { type: "text", placeholder: "Name" });
    const link = h("input", { type: "text", placeholder: "https://…", spellcheck: "false" });
    const key = h("input", { type: "password", autocomplete: "off", spellcheck: "false" });
    const result = resultLine();
    const chosen = () => PRESETS[Number(preset.value)];
    // A known provider needs only its key; "Something else" shows everything.
    const custom = h("div", { class: "custom" },
      h("div", { class: "field" }, h("label", { text: "Name" }), h("div", { class: "line" }, name, kind)),
      h("div", { class: "field" }, h("label", { text: "Link" }), link));
    const fillIn = () => {
      const pr = chosen();
      kind.value = pr.kind;
      name.value = pr.name;
      link.value = pr.link;
      key.placeholder = pr.keyHint;
      key.disabled = !!pr.noKey;
      custom.hidden = pr.link !== "";
    };
    preset.addEventListener("change", fillIn);
    fillIn();

    const add = h("button", { class: "primary", text: "Add" });
    add.addEventListener("click", async () => {
      result.clear();
      const pr = chosen();
      const baseUrl = link.value.trim();
      const secret = key.value.trim();
      if (!baseUrl) return result.fail("Enter the provider's link.");
      if (!secret && !pr.noKey) return result.fail("Paste the API key first.");
      try {
        await Bridge.checkProviderUrl(baseUrl);
      } catch (err) {
        return result.fail(err);
      }
      add.disabled = true;
      const provider: Provider = { id: freshId(), name: name.value.trim() || pr.label, kind: kind.value as ProviderKind, baseUrl, models: [...pr.models] };
      try {
        if (secret) await Bridge.providerKeySet(provider.id, secret);
      } catch (err) {
        add.disabled = false;
        return result.fail(`Couldn't save the key: ${errorText(err)}`);
      }
      const settings = s();
      settings.providers = [...settings.providers, provider];
      if (!settings.activeModel && provider.models.length) settings.activeModel = { providerId: provider.id, model: provider.models[0] };
      adding = false;
      open.add(provider.id); // straight to its models
      saveAndRedraw();
    });

    return h(
      "div",
      { class: "details adding" },
      h("div", { class: "field" }, h("label", { text: "Provider" }), preset),
      custom,
      h("div", { class: "field" }, h("label", { text: "API key" }), key),
      h("div", { class: "field" }, h("label"), h("div", { class: "line" }, add, h("button", { class: "quiet", text: "Cancel", onclick: () => ((adding = false), void redraw()) }))),
      result.el,
    );
  }

  void redraw();
  return {
    id: "models",
    title: "Chat models",
    lead: "The AI Tute chats with. Bring your own provider and key.",
    icon: ICONS.bubble,
    el,
    sync: () => void redraw(),
    refresh: () => void redraw(),
  };
}
