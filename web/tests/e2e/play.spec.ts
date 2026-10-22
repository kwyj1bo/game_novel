import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

type Scenes = Record<string, { choice?: { options: { correct: boolean; goto: string }[] } }>;
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../src/content/hp/${name}.story.json`, import.meta.url), "utf8"));
const chapters = [load("troll"), load("trapdoor")] as { id: string; start: string; scenes: Scenes }[];
const shotDir = "test-results/shots";

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

const engine = (page: Page) =>
  page.evaluate(() => {
    const e = (window as any).__engine;
    return { scene: e.runtime.currentScene as string, hud: e.hud.state as string, events: e.events as any[] };
  });

async function waitForHud(page: Page, state: string, timeout = 120_000) {
  await page.waitForFunction((s) => (window as any).__engine?.hud.state === s, state, { timeout });
}

// Waits for the nth choice (0-based) of the current chapter, then answers it.
async function choose(page: Page, correct: boolean, nth = 0) {
  await page.waitForFunction(
    (n) => {
      const e = (window as any).__engine;
      return e && e.hud.state === "choice" && e.events.filter((x: any) => x.type === "choice").length > n;
    },
    nth,
    { timeout: 120_000 },
  );
  const scene = await page.evaluate((want) => {
    const e = (window as any).__engine;
    const id = e.runtime.currentScene;
    const idx = e.story.scenes[id].choice.options.findIndex((o: any) => o.correct === want);
    e.hud.pick(idx);
    return id as string;
  }, correct);
  await page.screenshot({ path: `${shotDir}/${scene}-choice.png` });
  return scene;
}

async function beginChapter(page: Page, id: string, button = "Begin") {
  await page.locator(`.chapter[data-id="${id}"]`).getByRole("button", { name: button }).click();
}

for (const chapter of chapters) {
  const choiceScenes = Object.keys(chapter.scenes).filter((id) => chapter.scenes[id].choice);

  test(`${chapter.id}: full correct playthrough reaches the victory ending`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/?fast&mute");
    await beginChapter(page, chapter.id);
    const visited: string[] = [];
    for (let i = 0; i < choiceScenes.length; i++) visited.push(await choose(page, true, i));
    await waitForHud(page, "ending");
    await page.screenshot({ path: `${shotDir}/${chapter.id}-victory.png` });
    const { events } = await engine(page);
    expect(events.filter((e) => e.type === "ending").at(-1).ending.kind).toBe("victory");
    expect(visited).toEqual(choiceScenes);
    expect(events.filter((e) => e.type === "chosen").every((e) => e.option.correct)).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const id of choiceScenes) {
    test(`${chapter.id}: wrong choice in ${id} ends the run, and retry recovers`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(`/?fast&mute&scene=${id}`);
      await choose(page, false);
      await waitForHud(page, "ending");
      await page.screenshot({ path: `${shotDir}/${id}-wrong-ending.png` });
      let { events } = await engine(page);
      expect(events.filter((e) => e.type === "ending").at(-1).ending.kind).not.toBe("victory");

      await page.getByRole("button", { name: "Try again" }).click();
      // The retry rebuilds the scene instantly and asks the same question again.
      expect(await choose(page, true, 1)).toBe(id);
      const next = chapter.scenes[id].choice!.options.find((o) => o.correct)!.goto;
      await page.waitForFunction((n) => (window as any).__engine.events.some((e: any) => e.type === "scene" && e.id === n), next);
      ({ events } = await engine(page));
      expect(events.filter((e) => e.type === "chosen").map((e) => e.option.correct)).toEqual([false, true]);
      expect(errors).toEqual([]);
    });
  }
}

test("letting the timer run out picks the wrong option", async ({ page }) => {
  await page.goto("/?mute&scene=fluffy_intro");
  // Not in fast mode: the 8 second timer is real. Skip dialogue to reach it quickly.
  const skip = setInterval(() => page.evaluate(() => (window as any).__engine?.hud.advance()).catch(() => {}), 150);
  await waitForHud(page, "choice", 120_000);
  clearInterval(skip);
  await waitForHud(page, "ending", 60_000);
  const chosen = (await engine(page)).events.find((e) => e.type === "chosen");
  expect(chosen.timedOut).toBe(true);
  expect(chosen.option.correct).toBe(false);
});

test("progress is saved at a choice and resumes from the chamber's entrance", async ({ page }) => {
  await page.goto("/?fast&mute");
  await beginChapter(page, "hp1-trapdoor");
  await choose(page, true, 0);
  // Reach the second chamber's choice, then leave.
  await choose(page, true, 1);
  await page.reload();
  await beginChapter(page, "hp1-trapdoor", "Continue · Devil's Snare");
  await page.waitForFunction(() => (window as any).__engine?.runtime.currentScene === "snare_fall");
  expect((await engine(page)).events[0]).toMatchObject({ type: "scene", id: "snare_fall" });
});

test("the Chapters button returns to the menu", async ({ page }) => {
  await page.goto("/?fast&mute&scene=bathroom_fight");
  await choose(page, false);
  await waitForHud(page, "ending");
  await page.getByRole("button", { name: "Chapters" }).click();
  await expect(page.locator('.chapter[data-id="hp1-troll"]')).toBeVisible({ timeout: 15_000 });
});

test("uploading a novel adds generated chapters that play to the end", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/?fast&mute");
  await page.locator(".chapter.upload input[type=file]").setInputFiles(new URL("../../../tests/pipeline/fixtures/lighthouse.txt", import.meta.url).pathname);
  await expect(page.locator(".upload-status")).toHaveText("Added 1 chapter.", { timeout: 60_000 });
  const card = page.locator(".chapter", { hasText: "The Keeper's Hall" });
  await card.getByRole("button", { name: "Begin" }).click();
  await choose(page, true, 0);
  await waitForHud(page, "ending");
  const { events } = await engine(page);
  expect(events.filter((e) => e.type === "ending").at(-1).ending.kind).toBe("victory");
  expect(errors).toEqual([]);
});
