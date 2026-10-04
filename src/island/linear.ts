// Linear on the island: keeps "My issues" fresh while someone is looking, moves
// issues on one click (with Undo), and creates one-line issues. Every call goes
// through Rust (src-tauri/src/linear.rs) to Linear's MCP tools. Nothing polls:
// the views ask for a refresh when they are on screen, at most once a minute.

import {
  Bridge, DoWithClaude, LinearApi, type LinearCreated, type LinearIssue,
} from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { award, unaward } from "./bond";
import type { Island } from "./island";

/** A list younger than this is shown as is. */
const FRESH_MS = 60_000;
/** How long "DEV-12 done · Undo" stays. */
const UNDO_MS = 6000;

export type LinearMove = "started" | "completed";

export interface LinearActions {
  /** Reload "My issues" if it's stale (or now, with `force`). */
  refresh(force?: boolean): void;
  /** One click: Start or Done. Undo is offered for a few seconds. */
  move(issue: LinearIssue, to: LinearMove): void;
  undo(): void;
  /** Loads the teams once, for the new-issue form. */
  loadTeams(): void;
  /** The team a new issue goes to: the last one picked, else the usual one. */
  defaultTeam(): string | null;
  pickTeam(id: string): void;
  create(title: string, team: string, assignToMe: boolean, priority: number): Promise<LinearCreated>;
  /** The folder Claude works in for this team: Windows' picker, remembered. */
  pickFolder(team: string): Promise<void>;
  /** "Do it with Claude": opens Claude Code on the issue. */
  doWithClaude(issue: LinearIssue): Promise<void>;
}

function message(err: unknown): string {
  return String(err).replace(/^Error:\s*/, "");
}

export function linearActions(island: Island): LinearActions {
  let loading = false;
  let fetchedAt = 0;
  let undoTimer: number | null = null;

  const refresh = (force = false) => {
    if (!State.linear?.connected || loading) return;
    // Stamped before the call: a failing Linear is retried in a minute (or on
    // Retry), not on every redraw.
    if (!force && Date.now() - fetchedAt < FRESH_MS) return;
    fetchedAt = Date.now();
    loading = true;
    LinearApi.myIssues()
      .then((issues) => {
        State.linearIssues = issues;
        State.linearError = null;
      })
      .catch((err) => {
        State.linearError = message(err);
      })
      .finally(() => {
        loading = false;
        State.notify();
      });
  };

  const setUndo = (undo: typeof State.linearUndo) => {
    if (undoTimer != null) window.clearTimeout(undoTimer);
    undoTimer = null;
    State.linearUndo = undo;
    if (undo) {
      undoTimer = window.setTimeout(() => {
        undoTimer = null;
        State.linearUndo = null;
        State.notify();
      }, UNDO_MS);
    }
  };

  const move = (issue: LinearIssue, to: LinearMove) => {
    const before = { ...issue };
    const list = State.linearIssues ?? [];
    // Show it at once; the refresh after Linear answers brings the real names.
    if (to === "completed") {
      State.linearIssues = list.filter((i) => i.id !== issue.id);
    } else {
      State.linearIssues = list.map((i) =>
        i.id === issue.id ? { ...i, statusType: "started", status: "In progress" } : i);
    }
    setUndo({ issue: before, label: `${issue.id} ${to === "completed" ? "done" : "started"}` });
    Sound.play(to === "completed" ? "approve" : "blip");
    island.emote(to === "completed" ? "proud" : "happy");
    if (to === "completed") award("linear");
    State.notify();

    LinearApi.setState(issue.id, to, issue.team)
      .then(() => refresh(true))
      .catch((err) => {
        setUndo(null);
        // It didn't happen, so it doesn't count.
        if (to === "completed") unaward("linear");
        State.linearError = message(err);
        Sound.play("error");
        refresh(true);
      });
  };

  const undo = () => {
    const u = State.linearUndo;
    if (!u) return;
    setUndo(null);
    if (u.label.endsWith("done")) unaward("linear");
    // Put it back as it was, then let Linear confirm.
    const rest = (State.linearIssues ?? []).filter((i) => i.id !== u.issue.id);
    State.linearIssues = [u.issue, ...rest];
    Sound.play("blip");
    State.notify();
    // The exact status it had, by name: no team lookup needed.
    LinearApi.setState(u.issue.id, u.issue.status, "")
      .then(() => refresh(true))
      .catch((err) => {
        State.linearError = message(err);
        refresh(true);
      });
  };

  let teamsLoading = false;
  const loadTeams = () => {
    if (State.linearTeams || teamsLoading || !State.linear?.connected) return;
    teamsLoading = true;
    LinearApi.teams()
      .then((teams) => {
        State.linearTeams = teams;
      })
      .catch((err) => {
        State.linearError = message(err);
      })
      .finally(() => {
        teamsLoading = false;
        State.notify();
      });
  };

  const defaultTeam = (): string | null => {
    const teams = State.linearTeams ?? [];
    if (teams.length === 0) return null;
    const saved = State.settings.linearTeam;
    if (saved && teams.some((t) => t.id === saved)) return saved;
    // Otherwise the team most of your open issues are in.
    const counts = new Map<string, number>();
    for (const i of State.linearIssues ?? []) counts.set(i.team, (counts.get(i.team) ?? 0) + 1);
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return teams.find((t) => t.name === usual)?.id ?? teams[0].id;
  };

  const pickTeam = (id: string) => {
    State.settings.linearTeam = id;
    void Bridge.saveSettings(State.settings);
    State.notify();
  };

  const create = async (title: string, team: string, assignToMe: boolean, priority: number) => {
    const created = await LinearApi.createIssue(title, team, assignToMe, priority);
    Sound.play("approve");
    island.emote("happy");
    refresh(true);
    return created;
  };

  const pickFolder = async (team: string) => {
    const folder = await DoWithClaude.pickFolder();
    if (!folder) return;
    State.settings.claudeFolders = { ...State.settings.claudeFolders, [team]: folder };
    void Bridge.saveSettings(State.settings);
    Sound.play("blip");
    State.notify();
  };

  const doWithClaude = async (issue: LinearIssue) => {
    const folder = State.settings.claudeFolders[issue.team];
    if (!folder) throw new Error("Pick the folder Claude should work in first.");
    await DoWithClaude.start(issue.id, issue.team, folder);
    // Its session links to the issue when it sends its first prompt (claude.ts).
    State.claudeLaunches = [
      ...State.claudeLaunches.filter((l) => Date.now() - l.at < 10 * 60_000 && l.issue.id !== issue.id),
      { issue, at: Date.now() },
    ];
    State.linearIssues = (State.linearIssues ?? []).map((i) =>
      i.id === issue.id ? { ...i, statusType: "started", status: "In Progress" } : i);
    Sound.play("send");
    island.emote("happy");
    State.notify();
  };

  return { refresh, move, undo, loadTeams, defaultTeam, pickTeam, create, pickFolder, doWithClaude };
}
