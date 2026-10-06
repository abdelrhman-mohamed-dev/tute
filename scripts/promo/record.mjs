// Records the promo video. Serves nothing itself: promo.html (opened through
// `npx vite`) renders each frame on a virtual clock and posts it here as a PNG;
// when it says it's done, ffmpeg turns the frames into docs/promo/tute.mp4 and a
// smaller looping docs/promo/tute.gif for the README.
//
//   node scripts/promo/record.mjs        then open /scripts/promo/promo.html?record

import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const PORT = 1431;
const FPS = 30;
const root = join(import.meta.dirname, "..", "..");
const frames = join(root, "target", "promo", "frames");
const out = join(root, "docs", "promo");

rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
mkdirSync(out, { recursive: true });

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
}

function encode() {
  const input = ["-framerate", String(FPS), "-i", join(frames, "f%05d.png")];
  ffmpeg([...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", join(out, "tute.mp4")]);
  // GIF: 960 wide, 15 fps, one shared palette so the dark background stays clean.
  const palette = join(root, "target", "promo", "palette.png");
  const scale = "fps=15,scale=960:-1:flags=lanczos";
  ffmpeg([...input, "-vf", `${scale},palettegen=stats_mode=full`, palette]);
  ffmpeg([...input, "-i", palette, "-lavfi", `${scale}[v];[v][1:v]paletteuse=dither=sierra2_4a`, "-loop", "0", join(out, "tute.gif")]);
}

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const frame = req.url.match(/^\/frame\/(\d+)$/);
    if (frame) {
      writeFileSync(join(frames, `f${frame[1].padStart(5, "0")}.png`), Buffer.concat(chunks));
      if (Number(frame[1]) % 60 === 0) console.log("frame", frame[1]);
      return res.end("ok");
    }
    if (req.url === "/done") {
      console.log("encoding…");
      try {
        encode();
        // The sound (audio.mjs) re-encodes the MP4 from the frames with the music in.
        spawnSync("node", [join(import.meta.dirname, "audio.mjs")], { stdio: "inherit" });
        console.log("wrote docs/promo/tute.mp4 and tute.gif");
        res.end("ok");
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
      setTimeout(() => process.exit(0), 200);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}).listen(PORT, "127.0.0.1", () => console.log(`recorder on http://127.0.0.1:${PORT}`));
