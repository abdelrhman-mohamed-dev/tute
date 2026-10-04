// The Linear views: "My issues" (open issues assigned to you; click one for
// Start, Done, Open) and "New issue" (one line, Enter to create).

import { h, clear } from "./kit";
import { State } from "../core/state";
import type { LinearIssue } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";

const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"];

/** Linear's status colours by kind: in progress, not started, triage. */
function statusDot(issue: LinearIssue): HTMLElement {
  const dot = h("i", { class: "lin-status" });
  switch (issue.statusType) {
    case "started":
      dot.style.borderColor = "#f2c94c";
      dot.style.background = "rgba(242,201,76,0.35)";
      break;
    case "triage":
      dot.style.borderColor = "#f2994a";
      break;
    default:
      dot.style.borderColor = "#8e939c";
      if (issue.statusType === "backlog") dot.style.borderStyle = "dashed";
  }
  return dot;
}

/** The status as text, without the emoji some teams put in front. */
function statusText(issue: LinearIssue): string {
  return issue.status.replace(/^[^\p{L}\p{N}]+/u, "").trim() || issue.status;
}

// ── My issues ─────────────────────────────────────────────────────────────────

export function buildLinearIssues(actions: ViewActions): ViewHost {
  const count = h("span", { class: "dim-note" });
  const list = h("div", { class: "lin-list" });
  const footNote = h("span", { class: "dim-note" });
  const footer = h(
    "div",
    { class: "lin-foot" },
    footNote,
    h("div", { class: "grow" }),
    h("button", { class: "quick", text: "+ New issue", onclick: () => actions.setView("linear-new") }),
  );
  const el = h("div", { class: "view" },
    h("div", { class: "card" },
      h("div", { class: "stack lin-stack" },
        h("div", { class: "lin-head" }, h("span", { class: "lin-title", text: "My issues" }), count),
        list,
        footer,
      )));

  let selected: string | null = null;
  let renderedKey = "";

  function row(issue: LinearIssue): HTMLElement {
    const open = selected === issue.id;
    const r = h(
      "div",
      { class: open ? "lin-row on" : "lin-row", title: issue.title },
      statusDot(issue),
      h("span", { class: "lin-id", text: issue.id }),
      h("span", { class: "lin-text", text: issue.title }),
    );
    if (open) {
      const small = (label: string, onclick: () => void) =>
        h("button", { class: "btn secondary lin-act", text: label, onclick: (e: Event) => { e.stopPropagation(); onclick(); } });
      const buttons = h("span", { class: "lin-acts" });
      if (issue.statusType !== "started") buttons.append(small("Start", () => actions.linear.move(issue, "started")));
      const claude = small("✦ Claude", () => {
        State.claudeIssue = issue;
        actions.setView("linear-claude");
      });
      claude.classList.add("lin-claude");
      claude.title = "Do it with Claude";
      buttons.append(
        claude,
        small("Done", () => actions.linear.move(issue, "completed")),
        small("Open ↗", () => actions.openUrl(issue.url)),
      );
      r.append(buttons);
    } else {
      r.append(h("span", { class: "lin-chip", text: statusText(issue) }));
    }
    r.addEventListener("click", () => {
      selected = open ? null : issue.id;
      actions.blip();
      renderedKey = "";
      render();
    });
    return r;
  }

  function render() {
    const issues = State.linearIssues;
    const undo = State.linearUndo;
    const key = JSON.stringify([issues, selected, undo?.label, State.linearError]);
    if (key === renderedKey) return;
    renderedKey = key;

    clear(list);
    clear(footNote);
    count.textContent = issues ? `${issues.length} open` : "";
    if (!issues) {
      list.append(h("div", { class: "lin-empty", text: State.linearError ?? "Loading your issues…" }));
    } else if (issues.length === 0) {
      list.append(h("div", { class: "lin-empty", text: "Nothing open is assigned to you. Nice." }));
    } else {
      for (const issue of issues) list.append(row(issue));
    }

    if (undo) {
      footNote.append(
        h("span", { text: `${undo.label} · ` }),
        h("button", { class: "link-btn lin-undo", text: "Undo", onclick: () => actions.linear.undo() }),
      );
    } else if (State.linearError && issues) {
      footNote.append(
        h("span", { class: "lin-err", text: State.linearError }),
        h("button", { class: "link-btn lin-undo", text: " Retry", onclick: () => actions.linear.refresh(true) }),
      );
    }
  }

  return {
    el,
    sync() {
      actions.linear.refresh();
      render();
    },
  };
}

// ── New issue ─────────────────────────────────────────────────────────────────

export function buildLinearNew(actions: ViewActions): ViewHost {
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "What needs doing?",
    maxlength: "250",
  }) as HTMLInputElement;
  const hint = h("span", { class: "dim-note", text: "Enter ↵" });
  const field = h("div", { class: "chat-bar lin-field" }, input, hint);

  const teamChip = h("button", { class: "quick" });
  const assignChip = h("button", { class: "quick" });
  const priorityChip = h("button", { class: "quick" });
  const result = h("span", { class: "dim-note lin-result" });

  let assignToMe = true;
  let priority = 0;
  let busy = false;
  let created: { id: string; url: string } | null = null;
  let error: string | null = null;

  const el = h("div", { class: "view" },
    h("div", { class: "card" },
      h("div", { class: "stack lin-new" },
        h("span", { class: "lin-title", text: "New issue" }),
        field,
        h("div", { class: "lin-chips" }, teamChip, assignChip, priorityChip, h("div", { class: "grow" }), result),
      )));

  const team = () => actions.linear.defaultTeam();

  function render() {
    const teams = State.linearTeams ?? [];
    const current = teams.find((t) => t.id === team());
    clear(teamChip);
    teamChip.append(h("i", { class: "quick-dot", style: "background:#5e6ad2" }),
      h("span", { text: current ? `${current.name}${teams.length > 1 ? " ▾" : ""}` : "Loading teams…" }));
    teamChip.title = teams.length > 1 ? "Click for the next team" : "";
    assignChip.textContent = assignToMe ? "Assign to me ✓" : "Unassigned";
    priorityChip.textContent = `${PRIORITIES[priority]} ▾`;
    input.disabled = busy;
    hint.textContent = busy ? "Creating…" : "Enter ↵";

    clear(result);
    if (error) {
      result.append(h("span", { class: "lin-err", text: error }));
    } else if (created) {
      const label = created.id ? `Created ${created.id} ✓` : "Created ✓";
      result.append(created.url
        ? h("button", { class: "link-btn lin-created", text: `${label} ↗`, onclick: () => actions.openUrl(created!.url) })
        : h("span", { text: label }));
    }
  }

  teamChip.addEventListener("click", () => {
    const teams = State.linearTeams ?? [];
    if (teams.length < 2) return;
    const i = teams.findIndex((t) => t.id === team());
    actions.linear.pickTeam(teams[(i + 1) % teams.length].id);
    actions.blip();
  });
  assignChip.addEventListener("click", () => {
    assignToMe = !assignToMe;
    actions.blip();
    render();
  });
  priorityChip.addEventListener("click", () => {
    priority = (priority + 1) % PRIORITIES.length;
    actions.blip();
    render();
  });

  async function submit() {
    const title = input.value.trim();
    const teamId = team();
    if (!title || busy) return;
    if (!teamId) {
      error = "Your teams are still loading.";
      render();
      return;
    }
    busy = true;
    error = null;
    created = null;
    render();
    try {
      created = await actions.linear.create(title, teamId, assignToMe, priority);
      input.value = "";
    } catch (err) {
      error = String(err).replace(/^Error:\s*/, "");
    } finally {
      busy = false;
      render();
      input.focus();
    }
  }

  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    // Escape here goes back home rather than closing the island.
    if ((e as KeyboardEvent).key === "Escape") actions.setView(State.defaultView());
    e.stopPropagation();
  });
  input.addEventListener("input", () => {
    if (created || error) {
      created = null;
      error = null;
      render();
    }
  });

  return {
    el,
    sync() {
      actions.linear.loadTeams();
      render();
    },
    focus() {
      input.focus();
    },
  };
}

// ── Do it with Claude ─────────────────────────────────────────────────────────

/** Folder, what happens when done, Start. Claude then runs in its own window. */
export function buildLinearClaude(actions: ViewActions): ViewHost {
  const issueRow = h("div", { class: "lin-row on" });
  const folderChip = h("button", { class: "quick lin-folder" });
  const folderNote = h("span", { class: "dim-note" });
  const commentChip = h("button", { class: "quick" });
  const reviewChip = h("button", { class: "quick" });
  const start = h("button", { class: "btn lin-start", text: "Start Claude" }) as HTMLButtonElement;
  const cancel = h("button", { class: "btn secondary", text: "Cancel" });
  const status = h("span", { class: "dim-note lin-result" });

  const el = h("div", { class: "view" },
    h("div", { class: "card" },
      h("div", { class: "stack lin-stack" },
        issueRow,
        h("div", { class: "claude-box" },
          h("div", { class: "lin-head" },
            h("span", { class: "lin-title", text: "✦ Do it with Claude" }),
            h("span", { class: "dim-note", text: "Claude works on it while you do something else" })),
          h("div", { class: "claude-line" }, h("span", { class: "bond-label", text: "Folder" }), folderChip, folderNote),
          h("div", { class: "claude-line" }, h("span", { class: "bond-label", text: "When done" }), commentChip, reviewChip),
          h("div", { class: "claude-line" }, start, cancel, h("div", { class: "grow" }), status),
        ))));

  let busy = false;
  let error: string | null = null;

  function render() {
    const issue = State.claudeIssue;
    if (!issue) return;
    clear(issueRow);
    issueRow.append(statusDot(issue), h("span", { class: "lin-id", text: issue.id }),
      h("span", { class: "lin-text", text: issue.title }));

    const folder = State.settings.claudeFolders[issue.team];
    folderChip.textContent = folder ? `📁 ${folder} ▾` : "📁 Pick a folder…";
    folderChip.title = folder ?? "";
    folderNote.textContent = folder ? `remembered for ${issue.team}` : "";
    commentChip.textContent = "💬 Comment summary";
    commentChip.classList.toggle("on", State.settings.claudeDoneComment);
    reviewChip.textContent = "→ Review";
    reviewChip.classList.toggle("on", State.settings.claudeDoneReview);
    start.disabled = busy || !folder;
    start.textContent = busy ? "Starting…" : "Start Claude";
    status.textContent = error ?? "Questions and permissions come here";
    status.classList.toggle("lin-err", !!error);
  }

  folderChip.addEventListener("click", async () => {
    const issue = State.claudeIssue;
    if (!issue) return;
    await actions.linear.pickFolder(issue.team);
    render();
  });
  const toggle = (key: "claudeDoneComment" | "claudeDoneReview") => {
    State.settings[key] = !State.settings[key];
    actions.saveSettings();
    actions.blip();
    render();
  };
  commentChip.addEventListener("click", () => toggle("claudeDoneComment"));
  reviewChip.addEventListener("click", () => toggle("claudeDoneReview"));
  cancel.addEventListener("click", () => actions.setView("linear"));
  start.addEventListener("click", async () => {
    const issue = State.claudeIssue;
    if (!issue || busy) return;
    busy = true;
    error = null;
    render();
    try {
      await actions.linear.doWithClaude(issue);
      State.claudeIssue = null;
      actions.collapse();
    } catch (err) {
      error = String(err).replace(/^Error:\s*/, "");
    } finally {
      busy = false;
      render();
    }
  });

  let shownIssue: string | null = null;

  return {
    el,
    sync() {
      // A fresh card for each issue; an error stays until then.
      if (State.claudeIssue?.id !== shownIssue) {
        shownIssue = State.claudeIssue?.id ?? null;
        error = null;
      }
      render();
    },
  };
}
