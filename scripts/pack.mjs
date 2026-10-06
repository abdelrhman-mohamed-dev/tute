// `npm run pack`, after `tauri build`: takes the newest installer out of
// target/release/bundle/nsis/ and puts it in release/ twice, as
// Tute-Windows-<version>-setup.exe and as Tute-Windows-setup.exe (the name a
// "latest" download link can point at).

import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(project, "target", "release", "bundle", "nsis");
const release = join(project, "release");

function newestInstaller() {
  let names = [];
  try {
    names = readdirSync(built).filter((name) => name.endsWith("-setup.exe"));
  } catch {
    // No folder yet: same answer as an empty one.
  }
  if (!names.length) {
    console.error(`No installer in ${built}. Run \`npm run tauri build\` first.`);
    process.exit(1);
  }
  const age = (name) => statSync(join(built, name)).mtimeMs;
  return join(built, names.sort((a, b) => age(b) - age(a))[0]);
}

const { version } = JSON.parse(readFileSync(join(project, "src-tauri", "tauri.conf.json"), "utf8"));
const installer = newestInstaller();
const copies = [`Tute-Windows-${version}-setup.exe`, "Tute-Windows-setup.exe"].map((name) => join(release, name));

mkdirSync(release, { recursive: true });
for (const copy of copies) copyFileSync(installer, copy);

const size = (statSync(copies[0]).size / 2 ** 20).toFixed(2);
console.log(`\n  Installer ready (${size} MB)\n\n  ${copies.join("\n  ")}\n`);
