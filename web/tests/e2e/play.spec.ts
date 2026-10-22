import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const story = JSON.parse(readFileSync(new URL("../../src/content/hp/trapdoor.story.json", import.meta.url), "utf8"));

type Scenes = Record<string, { choice?: { options: { correct: boolean; goto: string }[] } }>;
const scenes = story.scenes as Scenes;
const choiceScenes = Object.keys(scenes).filter((id) => scenes[id].choice);
const shotDir = "test-results/shots";

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

const engine = (page: Page) => page.evaluate(() => {
  const e = (window as any).__engine;
  return { scene: e.runtime.currentScene as string, hud: e.hud.state as string, events: e.events as any[] };
});

async function waitForHud(page: Page, state: string, timeout = 120_000) {
  await page.waitForFunction((s) => (window as any).__engine?.hud.state === s, state, { timeout });
}

async function choose(page: Page, correct: boolean, nth = 0) {
  // Wait for the nth choice event (0-based) so a previous choice can't satisfy the wait.
  await page.waitForFunction((n) => {
    const e = (window as any).__engine;
    return e && e.hud.state === "choice" && e.events.filter((x: any) => x.type === "choice").length > n;
  }, nth, { timeout: 120_000 });
  const { scene } = await engine(page);
  await page.screenshot({ path: `${shotDir}/${scene}-choice.png` });
  const idx = scenes[scene].choice!.options.findIndex((o) => o.correct === correct);
  await page.keyboard.press(String(idx + 1));
  return scene;
}

test("full correct playthrough reaches the victory ending", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/?fast&mute");
  await page.getByRole("button", { name: "Begin" }).click();
  const visited: string[] = [];
  for (let i = 0; i < choiceScenes.length; i++) visited.push(await choose(page, true, i));
  await waitForHud(page, "ending");
  await page.screenshot({ path: `${shotDir}/victory.png` });
  const { events } = await engine(page);
  const ending = events.filter((e) => e.type === "ending").at(-1);
  expect(ending.ending.kind).toBe("victory");
  expect(visited).toEqual(["fluffy_intro", "snare_fall", "keys_enter", "chess_enter", "potions_enter", "mirror_enter"]);
  expect(events.filter((e) => e.type === "chosen").every((e) => e.option.correct)).toBe(true);
  expect(errors).toEqual([]);
});

for (const id of choiceScenes) {
  test(`wrong choice in ${id} ends the run, and retry recovers`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/?fast&mute&scene=${id}`);
    await choose(page, false);
    await waitForHud(page, "ending");
    await page.screenshot({ path: `${shotDir}/${id}-wrong-ending.png` });
    let { events } = await engine(page);
    const ending = events.filter((e) => e.type === "ending").at(-1);
    expect(ending.ending.kind).not.toBe("victory");

    await page.getByRole("button", { name: "Try again" }).click();
    // The retry rebuilds the scene instantly and asks the same question again.
    await choose(page, true, 1);
    expect((await engine(page)).scene).toBe(id);
    const next = scenes[id].choice!.options.find((o) => o.correct)!.goto;
    await page.waitForFunction((n) => (window as any).__engine.events.some((e: any) => e.type === "scene" && e.id === n), next);
    ({ events } = await engine(page));
    const chosen = events.filter((e) => e.type === "chosen");
    expect(chosen.map((e) => e.option.correct)).toEqual([false, true]);
    expect(errors).toEqual([]);
  });
}

test("letting the timer run out picks the wrong option", async ({ page }) => {
  await page.goto("/?mute&scene=fluffy_intro");
  // Not in fast mode: the 8 second timer is real. Skip dialogue to reach it quickly.
  const skip = setInterval(() => page.evaluate(() => (window as any).__engine?.hud.advance()).catch(() => {}), 150);
  await waitForHud(page, "choice", 120_000);
  clearInterval(skip);
  await waitForHud(page, "ending", 60_000);
  const { events } = await engine(page);
  const chosen = events.find((e) => e.type === "chosen");
  expect(chosen.timedOut).toBe(true);
  expect(chosen.option.correct).toBe(false);
});
