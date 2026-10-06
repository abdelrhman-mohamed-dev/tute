// The island's views: what each one can ask of the island (ViewActions), what
// the island needs from each (ViewHost), and the list of them all.
//
// Each view lives in its own file: home.ts (overview, empty), alerts.ts,
// chat.ts, ask.ts, linear.ts, obsidian.ts, bond.ts, gear.ts, upload.ts, picker.ts; the
// header is header.ts and the shared pieces are in kit.ts.

import type { BotEmoteName, IslandViewName } from "../core/layout";
import type { ActiveModel } from "../core/state";
import type { ClaudeReply } from "../core/bridge";
import type { Personality } from "../jelly/looks";
import type { LinearActions } from "../island/linear";
import { buildApproval, buildConfused, buildError, buildFinished, buildNote } from "./alerts";
import { buildAsk } from "./ask";
import { buildBond, buildLevelUp } from "./bond";
import { buildPrompt } from "./chat";
import { buildGear } from "./gear";
import { buildEmpty, buildOverview } from "./home";
import { buildLinearClaude, buildLinearIssues, buildLinearNew } from "./linear";
import { buildObsidian } from "./obsidian";
import { buildPicker } from "./picker";
import { buildChoose, buildUpload, buildUploading } from "./upload";

export { buildHeader } from "./header";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  openUrl(url: string): void;
  /** Choose card, primary button: the dropped file stays in the inbox. */
  keepFile(): void;
  /** Choose card, Cancel: delete the inbox copy and close the card. */
  cancelFile(): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
  /** First-launch picker: save the character and greet with it. */
  pickPersonality(p: Personality): void;
  /** Settings: switch character in place, no greeting. */
  setPersonality(p: Personality): void;
  /** Home quick action: connect Linear, or show your issues once connected. */
  linearAction(): void;
  /** Home quick action: Obsidian, or choosing the vault if there's none yet. */
  obsidianAction(): void;
  /** Choose card: the dropped file goes into the Obsidian vault. */
  saveToObsidian(): void;
  /** A browsing chat: bring its tab to the front, or stop it. */
  browseWatch(id: string): void;
  browseStop(id: string): void;
  /** Linear: issues, moves with Undo, new issues (island/linear.ts). */
  linear: LinearActions;
  /** Saves State.settings as they are now. */
  saveSettings(): void;
  /** Chat: Fun or Focus answers (saved). */
  setChatMode(mode: "fun" | "focus"): void;
  /** A one-off reaction from the character. */
  emote(name: BotEmoteName): void;
  /** Bond: shows a locked look on the character for a few seconds. */
  tryOn(look: { wear?: "hat" | "crown"; skin?: "mint" | "lemon" | "lilac" }): void;
  /** Bond: what the character wears, its colour, and the twirl on demand. */
  setWear(wear: "hat" | "crown" | null): void;
  setSkin(skin: "mint" | "lemon" | "lilac" | null): void;
  twirl(): void;
  /** Ask card: the answer to a Claude question or permission prompt; null = terminal. */
  answerAsk(requestId: number, reply: ClaudeReply | null): void;
  /** Chat and gear view: make this the model the chat uses. */
  setActiveModel(m: ActiveModel): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
  /** True while the view is mid-animation: keeps the frame loop running. */
  busy?(): boolean;
}

/** Every view, by name. `onChatResize`: the chat grew, so the island should too. */
export function buildViews(actions: ViewActions, onChatResize: () => void): Map<IslandViewName, ViewHost> {
  const views: [IslandViewName, ViewHost][] = [
    ["overview", buildOverview(actions)],
    ["empty", buildEmpty(actions)],
    ["prompt", buildPrompt(actions, onChatResize)],
    ["ask", buildAsk(actions)],
    ["approval", buildApproval(actions)],
    ["finished", buildFinished(actions)],
    ["error", buildError(actions)],
    ["confused", buildConfused()],
    ["note", buildNote()],
    ["linear", buildLinearIssues(actions)],
    ["linear-new", buildLinearNew(actions)],
    ["linear-claude", buildLinearClaude(actions)],
    ["obsidian", buildObsidian(actions)],
    ["levelup", buildLevelUp(actions)],
    ["bond", buildBond(actions)],
    ["settings", buildGear(actions)],
    ["upload", buildUpload()],
    ["uploading", buildUploading()],
    ["choose", buildChoose(actions)],
    ["personality", buildPicker((p) => actions.pickPersonality(p))],
  ];
  return new Map(views);
}
