// The model menu on the island (the chat and the gear view): every model added
// in Settings → AI models. Picking one makes it the chat's model.

import { State, type ActiveModel } from "../core/state";
import { h } from "./kit";

export interface ModelPicker {
  el: HTMLSelectElement;
  /** Rebuilds the list when the providers changed, and shows the active model. */
  sync(): void;
}

const valueOf = (m: ActiveModel) => JSON.stringify({ providerId: m.providerId, model: m.model });

export function modelPicker(picked: (m: ActiveModel) => void): ModelPicker {
  const el = h("select", { class: "model-pick", title: "Model" });
  let listed = "";
  el.addEventListener("change", () => {
    if (el.value) picked(JSON.parse(el.value) as ActiveModel);
  });
  // Escape and the arrow keys belong to the open menu, not to the island.
  el.addEventListener("keydown", (e) => e.stopPropagation());

  return {
    el,
    sync() {
      const { providers, activeModel } = State.settings;
      const all = providers.flatMap((p) => p.models.map((model) => ({ p, model })));
      const key = JSON.stringify(all.map(({ p, model }) => [p.id, p.name, model]));
      if (key !== listed) {
        listed = key;
        el.replaceChildren(
          h("option", { value: "", text: all.length ? "Choose a model…" : "No models yet" }),
          ...all.map(({ p, model }) => h("option", { value: valueOf({ providerId: p.id, model }), text: `${p.name} · ${model}` })),
        );
        el.disabled = !all.length;
      }
      // A model that's gone shows as "Choose a model…".
      const want = activeModel ? valueOf(activeModel) : "";
      el.value = [...el.options].some((o) => o.value === want) ? want : "";
    },
  };
}
