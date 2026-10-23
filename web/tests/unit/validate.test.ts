import { describe, expect, it } from "vitest";
import { parseStory } from "../../src/engine/story/schema";
import { validateStory } from "../../src/engine/story/validate";
import { LOCATIONS, makeStory } from "./fakes";

const messages = (story = makeStory()) => validateStory(story, LOCATIONS).map((i) => i.message);

describe("validateStory", () => {
  it("accepts a well-formed story", () => {
    expect(messages()).toEqual([]);
  });

  it("round-trips through the schema", () => {
    expect(() => parseStory(makeStory())).not.toThrow();
  });

  it("rejects a scene with two terminators", () => {
    const raw = makeStory() as any;
    raw.scenes.s1.ending = { kind: "death", title: "a", text: "b" };
    expect(() => parseStory(raw)).toThrow(/exactly one of/);
  });

  it("rejects unknown beat shapes", () => {
    const raw = makeStory() as any;
    raw.scenes.s1.beats.push({ dance: "harry" });
    expect(() => parseStory(raw)).toThrow();
  });

  it("requires exactly one correct option", () => {
    const s = makeStory();
    s.scenes.s2.choice!.options[1].correct = true;
    expect(messages(s)).toContain("choice must have exactly one correct option (has 2)");
  });

  it("forbids a wrong option that leads to another choice", () => {
    const s = makeStory();
    s.scenes.bad = { ...s.scenes.s2, location: "hall" };
    expect(messages(s).some((m) => m.includes("must end the run"))).toBe(true);
  });

  it("forbids a correct option that leads to a losing ending", () => {
    const s = makeStory();
    s.scenes.ok.ending = { kind: "death", title: "a", text: "b" };
    expect(messages(s).some((m) => m.includes("leads to a death ending"))).toBe(true);
  });

  it("reports unknown marks, actors not on stage and bad prop states", () => {
    const s = makeStory();
    s.scenes.s1.beats.push({ move: "harry", to: "nowhere" });
    s.scenes.ok.beats.push({ say: "ron", text: "hey" });
    s.scenes.s1.beats.push({ prop: "door", state: "melted" });
    const m = messages(s);
    expect(m.some((x) => x.includes('"nowhere" is not a mark'))).toBe(true);
    expect(m.some((x) => x.includes('actor "ron" is not on stage'))).toBe(true);
    expect(m.some((x) => x.includes('no state "melted"'))).toBe(true);
  });

  it("rejects a camera aimed at an actor who is not on stage", () => {
    const s = makeStory();
    s.scenes.ok.beats.push({ camera: "close", on: "ron" });
    expect(messages(s).some((m) => m.includes('"ron" is not a mark in pit or an actor on stage'))).toBe(true);
  });

  it("detects cycles and unreachable scenes", () => {
    const s = makeStory();
    s.scenes.ok = { ...s.scenes.ok, ending: undefined, goto: "s1" };
    s.scenes.orphan = { location: "pit", cast: {}, beats: [], ending: { kind: "victory", title: "", text: "" } };
    const m = messages(s);
    expect(m.some((x) => x.startsWith("cycle"))).toBe(true);
    expect(m).toContain("scene is unreachable from start");
  });
});

describe("action assets", () => {
  it("every manifest action expands to valid beats and has a known opposite", async () => {
    const { MANIFEST } = await import("../../src/locations");
    const { expandAction } = await import("../../src/engine/story/actions");
    const ids = new Set(MANIFEST.actions.map((a) => a.id));
    for (const a of MANIFEST.actions) {
      expect(() => expandAction(a, { actor: "a", target: "b", object: "the key" })).not.toThrow();
      if (a.opposite) expect(ids.has(a.opposite)).toBe(true);
    }
  });
});
