// Vite serves and bundles the two pages: the island (index.html) and the
// settings window (settings.html). Port 1420 is the one tauri.conf.json expects.

import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Rust is the Tauri CLI's to watch. target/ in particular: Cargo writes
    // thousands of files there (often locked by the antivirus), and watching
    // them crashes Vite with EBUSY.
    watch: { ignored: ["**/target/**", "**/src-tauri/**", "**/release/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
      },
    },
  },
});
