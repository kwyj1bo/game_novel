import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Dev tool: load the game headless and capture screenshots on a schedule.
// Usage: vite-node scripts/shoot.ts -- "<query>" <outDir> <ms,ms,...> [choice@ms ...]
//   e.g. vite-node scripts/shoot.ts -- "scene=fluffy_intro&mute" shots 3000,8000 pick0@20000
const [query = "mute", out = "shots", times = "3000", ...actions] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://localhost:5173/?${query}`);
const t0 = Date.now();

const schedule = [
  ...times.split(",").map((ms) => ({ at: Number(ms), kind: "shot" as const, arg: ms })),
  ...actions.map((a) => {
    const [what, ms] = a.split("@");
    return { at: Number(ms), kind: "act" as const, arg: what };
  }),
].sort((a, b) => a.at - b.at);

for (const s of schedule) {
  const wait = s.at - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  if (s.kind === "shot") {
    await page.screenshot({ path: `${out}/t${s.arg.padStart(6, "0")}.png` });
    const info = await page.evaluate(() => {
      const e = (window as any).__engine;
      return e ? { fps: Math.round(e.fps), scene: e.runtime.currentScene, hud: e.hud.state, line: e.hud.lastLine } : null;
    });
    console.log(`shot ${s.arg}ms`, JSON.stringify(info));
  } else if (s.arg.startsWith("pick")) {
    await page.evaluate((i) => (window as any).__engine.hud.pick(i), Number(s.arg.slice(4)));
  } else if (s.arg === "begin") {
    await page.click("text=Begin");
  } else if (s.arg.startsWith("ending:")) {
    await page.evaluate((l) => (window as any).__engine.hud.clickEnding(l), s.arg.slice(7));
  }
}
await browser.close();
