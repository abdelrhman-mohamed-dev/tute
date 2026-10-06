// Tute's browser extension. It waits for commands from Tute on this PC
// (127.0.0.1, with Tute's token) and carries them out in a "Tute" tab group:
// open a page, search with your default search engine, read a page, show a
// tab. Version 1 only reads: it never clicks, types or submits anything.
//
// config.js (written by Tute next to this file) holds the port and the token.
importScripts("config.js");

const BASE = `http://127.0.0.1:${TUTE.port}/browser`;
const HEADERS = { "X-Tute-Token": TUTE.token, "Content-Type": "application/json" };
/** How much of a page goes back to Tute: its text, and its links. */
const MAX_TEXT = 12000;
const MAX_LINKS = 60;

// ── Talking to Tute ─────────────────────────────────────────────────────────

let polling = false;

/** Asks Tute for the next command (Tute holds the request until it has one). */
async function poll() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      let command = null;
      try {
        const reply = await fetch(`${BASE}/next`, { headers: HEADERS });
        if (reply.status === 200) command = await reply.json();
        else if (reply.status !== 204) await sleep(5000);
      } catch {
        // Tute isn't running: try again in a while.
        await sleep(5000);
      }
      // Any extension call keeps this worker awake between polls.
      await chrome.runtime.getPlatformInfo();
      if (command) void run(command);
    }
  } finally {
    polling = false;
  }
}

async function run(command) {
  let result;
  try {
    result = { id: command.id, ok: true, data: await carryOut(command) };
  } catch (err) {
    result = { id: command.id, ok: false, error: String(err?.message ?? err) };
  }
  await fetch(`${BASE}/result`, { method: "POST", headers: HEADERS, body: JSON.stringify(result) }).catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Commands ────────────────────────────────────────────────────────────────

async function carryOut(c) {
  switch (c.kind) {
    case "hello":
      return { browser: navigator.userAgent };
    case "open":
      return openPage(c.task, c.url);
    case "search":
      return searchFor(c.task, c.query);
    case "read":
      return readTab(await taskTab(c.task, false));
    case "watch":
      return showTab(c.task);
    case "done":
      return finish(c.task, c.close);
    default:
      throw new Error(`Unknown command ${c.kind}`);
  }
}

/** Each task has its own tab, in the "Tute" group, opened without stealing focus. */
const tabs = new Map();

async function taskTab(task, create = true) {
  const known = tabs.get(task);
  if (known) {
    try {
      return await chrome.tabs.get(known);
    } catch {
      tabs.delete(task); // closed by you
    }
  }
  if (!create) throw new Error("That page was closed.");
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  tabs.set(task, tab.id);
  try {
    const group = await chrome.tabs.group({ tabIds: tab.id });
    await chrome.tabGroups.update(group, { title: "Tute", color: "blue" });
  } catch {
    // Tab groups are a nicety.
  }
  return tab;
}

function loaded(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listen);
      clearTimeout(timer);
      resolve();
    };
    const listen = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, 20000);
    chrome.tabs.onUpdated.addListener(listen);
  });
}

async function openPage(task, url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http and https pages can be opened.");
  const tab = await taskTab(task);
  const ready = loaded(tab.id);
  await chrome.tabs.update(tab.id, { url });
  await ready;
  await sleep(600); // pages that fill in after loading
  return readTab(await chrome.tabs.get(tab.id));
}

async function searchFor(task, query) {
  const tab = await taskTab(task);
  const ready = loaded(tab.id);
  // Your default search engine, as if you'd typed it in the address bar.
  await chrome.search.query({ text: query, tabId: tab.id });
  await ready;
  await sleep(600);
  return readTab(await chrome.tabs.get(tab.id));
}

async function readTab(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readPage,
    args: [MAX_TEXT, MAX_LINKS],
  });
  return result;
}

/** Runs inside the page: its title, address, readable text and links. */
function readPage(maxText, maxLinks) {
  const main = document.querySelector("main, article, [role=main]") ?? document.body;
  const text = (main?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxText);
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    const label = (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 100);
    if (!/^https?:/i.test(href) || !label || seen.has(href)) continue;
    seen.add(href);
    links.push({ text: label, url: href });
    if (links.length >= maxLinks) break;
  }
  return { title: document.title, url: location.href, text, links };
}

async function showTab(task) {
  const tab = await taskTab(task, false);
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return {};
}

async function finish(task, close) {
  const id = tabs.get(task);
  tabs.delete(task);
  if (id && close) await chrome.tabs.remove(id).catch(() => {});
  return {};
}

// ── Staying connected ───────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
// A browser may put this worker to sleep: the alarm wakes it and picks up again.
chrome.alarms.create("tute", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(poll);
poll();
