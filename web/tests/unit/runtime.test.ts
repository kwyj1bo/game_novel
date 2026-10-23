import { describe, expect, it } from "vitest";
import { StoryRuntime, type RuntimeEvent } from "../../src/engine/story/StoryRuntime";
import { FakeHud, FakeStage, makeStory, StopRun } from "./fakes";

async function run(choices: number[], endingActions: ("retry" | "restart")[]) {
  const stage = new FakeStage();
  const hud = new FakeHud(choices, endingActions);
  const rt = new StoryRuntime(makeStory(), stage, hud);
  const events: RuntimeEvent[] = [];
  rt.on((e) => events.push(e));
  await rt.start({ skipTitle: true }).catch((e) => {
    if (!(e instanceof StopRun)) throw e;
  });
  return { stage, hud, events };
}

describe("StoryRuntime", () => {
  it("plays the correct path through to victory", async () => {
    const { hud, stage } = await run([0], []);
    expect(hud.endings.map((e) => e.kind)).toEqual(["victory"]);
    expect(hud.lines).toEqual(["Hi", "Down we go"]);
    expect(stage.location).toBe("pit");
  });

  it("a wrong choice ends the run", async () => {
    const { hud, events } = await run([1], []);
    expect(hud.endings.map((e) => e.kind)).toEqual(["death"]);
    expect(events.filter((e) => e.type === "chosen").map((e: any) => e.option.label)).toEqual(["Wrong"]);
  });

  it("running out of time takes the wrong option", async () => {
    const { events } = await run([-1], []);
    const chosen = events.find((e) => e.type === "chosen") as any;
    expect(chosen.timedOut).toBe(true);
    expect(chosen.option.correct).toBe(false);
  });

  it("retry rebuilds the room instantly and re-asks the choice", async () => {
    const { hud, stage } = await run([1, 0], ["retry"]);
    expect(hud.endings.map((e) => e.kind)).toEqual(["death", "victory"]);
    // Dialogue is not replayed during the instant rebuild.
    expect(hud.lines).toEqual(["Hi", "Down we go"]);
    // The prop set in the earlier scene and the move in the choice scene are restored.
    const afterRetry = stage.log.slice(stage.log.lastIndexOf("load:hall"));
    expect(afterRetry).toContain("prop:door=open");
    expect(afterRetry).toContain("move:harry->door!");
  });

  it("restart after victory goes back to the start", async () => {
    const { events } = await run([0, 1], ["restart"]);
    const scenes = events.filter((e) => e.type === "scene").map((e: any) => e.id);
    expect(scenes).toEqual(["s1", "s2", "ok", "s1", "s2", "bad"]);
  });

  it("keeps actors in place between scenes in the same location", async () => {
    const { stage } = await run([1], []);
    // ron leaves when the cast drops him; harry is never re-placed.
    expect(stage.log.filter((l) => l.startsWith("place:harry")).length).toBe(1);
    expect(stage.log).toContain("remove:ron");
  });
});

describe("act beats", () => {
  it("expand an action asset with its parameters", async () => {
    const story = makeStory();
    story.scenes.s1.beats.push({ act: "pat", actor: "ron", target: "harry" });
    const stage = new FakeStage();
    const hud = new FakeHud([0], []);
    const actions = {
      pat: { id: "pat", params: ["actor", "target"] as const, steps: [{ move: "$actor", to: "$target" }, { anim: "$actor", clip: "pat" }], text: "", label: "" },
    };
    const rt = new StoryRuntime(story, stage, hud, actions);
    await rt.start({ skipTitle: true }).catch((e) => {
      if (!(e instanceof StopRun)) throw e;
    });
    expect(stage.log).toContain("move:ron->harry");
    expect(stage.log).toContain("anim:ron:pat");
  });
});
