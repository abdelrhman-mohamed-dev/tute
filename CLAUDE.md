# Tute — guide for AI coding agents

Tute is a Windows desktop app: a small animated island at the top of the screen
(Tauri 2 + Rust backend, Vite + TypeScript front end with no UI framework).

## Where things are
- `src/` — front end. `src/island/island.ts` is the controller (modes, views, frame
  loop); beside it `shape.ts` (outline), `character.ts` (the jelly on the island),
  `pointer.ts` (cursor and keys), `dropflow.ts` (file drop), `actions.ts` (what views
  can ask for). `src/views/` holds the views.
- `src-tauri/src/` — Rust: the window (`island.rs`), displays (`display.rs`), the
  cursor watcher and click-through (`watch.rs`), file drop (`catcher.rs`, `inbox.rs`),
  Claude Code (`claude.rs`, `agent.rs`), Linear (`linear.rs`), settings, tray, log.

## Build
```
npm install
npm run tauri dev
```

## Rules
- No third-party dependencies unless truly unavoidable. The character is drawn in
  code on a canvas — no image or animation libraries.
- No telemetry. No network calls except to services the user configures.
- The island stays on screen as a small bar by default (Settings → Hide when idle
  turns hiding back on). So no endless animation: when nothing moves, the frame
  loop must stop (long sleep settles into a still pose for that reason), and the
  cursor watcher slows down while the cursor is far away. Hidden = 0 % CPU.
- Keep the identifier `dev.abdelrhman.tute` (settings and autostart depend on it).
- The character is tute's own jelly design (`src/jelly/jelly.ts`) — never bring
  back Coucou's Mochi look, moves or its black-notch window. The window is a
  dark slate tile floating below the top edge (`#island` in src/styles/shell.css, gap
  `TILE_GAP`; accent colour via `--jelly` / `--jelly-rgb`),
  and the greeting, the three-poke splat and the "absorb" drop are tute's own.
- Sounds are tute's own, made in code (`src/core/synth.ts`): no audio files,
  no samples from anywhere else. A new sound is a new recipe there.
- The jelly wobbles and its bubbles drift only while `engine.live` is on (the
  island is open), so an idle island stops redrawing.
