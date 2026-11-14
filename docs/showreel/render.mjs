import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const mode = process.argv[2] || "stills";
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
p.on("pageerror", e => console.log("PAGEERR", e.message));
await p.goto("file://" + process.cwd() + "/reel.html");
await p.waitForFunction("window.READY===true");
await p.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => 0))));
if (mode === "stills") {
  for (const t of process.argv.slice(3).map(Number)) { await p.evaluate(t => setT(t), t); await p.screenshot({ path: `out/still-${t.toFixed(2)}.jpg`, type: "jpeg", quality: 80 }); }
} else {
  const FPS = 30, N = 20 * FPS;
  const ff = spawn("ffmpeg", ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", "out/zap-showreel.mp4"], { stdio: ["pipe", "ignore", "inherit"] });
  for (let f = 0; f < N; f++) { await p.evaluate(t => setT(t), f / FPS); const buf = await p.screenshot({ type: "jpeg", quality: 96 }); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r)); if (f % 100 === 0) console.log("frame", f); }
  ff.stdin.end(); await new Promise(r => ff.on("close", r));
}
await b.close();
