# Tute

A small jelly that lives at the top of your Windows screen. It sits in a little
bar, opens on click, and keeps you company while you work:

- **Claude Code** — your sessions show on the island as they run; it tells you
  when one finishes or needs you, and you can answer its questions and
  permission prompts right there.
- **Linear** — your issues, quick moves, new issues, and "Do it with Claude" to
  hand an issue to a Claude Code session. Connects like an MCP client, with
  your own account: no keys to set up.
- **Chat** — ask it anything, in a playful or a focused voice.
- **Files** — drag a file onto it and the jelly absorbs it.
- **Bond** — the more you use it, the more it unlocks: hats, colours, a crown.

## Made in code

The jelly (`src/jelly/`), the window, the icons, the launch greeting, the
three-poke splat, the "absorb" drop and every sound (`src/core/synth.ts`) are
all drawn or synthesised in code. There are no image, animation or audio files.

## Build

You need **Node.js 20+**, **Rust** (stable, MSVC) and the **MSVC build tools**
("Desktop development with C++"). WebView2 ships with Windows 11.

```
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # installer in release/
```

`npm run dev` alone opens the island in a normal browser, which is enough for
visual work (no window, tray or drop).

If your antivirus flags or locks `target\release\tute.exe` while building, add
an exclusion for this project's `target\` folder: new unsigned executables are a
common false positive.

## Layout

```
src/                 front end (Vite + TypeScript, no framework)
  core/              state, layout, animation, sounds (made in code), bridge to Rust
  island/            island controller, state machine, Claude Code and Linear
  jelly/             the character, drawn on a canvas
  upload/            the drop sequence
  views/             island views (kit.ts: the shared pieces)
  styles/            the island's CSS, by area (base.css: the tokens)
  settings/          settings window
src-tauri/           Rust backend (Tauri 2)
  src/island.rs      the window: placement, focus
  src/display.rs     displays: which one the island lives on
  src/watch.rs       cursor watcher, click-through, drag detection
  src/catcher.rs     the native window that takes dropped files
  src/inbox.rs       copies dropped files into the inbox
  src/claude.rs      Claude Code hooks (local listener)
  src/linear.rs      Linear over MCP (OAuth, no keys)
```

## Where things live on disk

- Settings: `%APPDATA%\Tute\settings.json`
- Dropped files: `%LOCALAPPDATA%\Tute\inbox\` (swept after a week)
- Log: `%LOCALAPPDATA%\Tute\tute.log`

## License

MIT — see [LICENSE](LICENSE).

Thanks to [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT),
which Tute grew out of; parts of its code are still in here.
