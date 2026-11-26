import { describe, expect, it } from "vitest";
import { Director } from "../../src/engine/story/Director";
import { parseStory } from "../../src/engine/story/schema";
import { validateStory } from "../../src/engine/story/validate";
import { generatedLocation } from "../../src/locations/generated";
import { FakeHud, FakeStage, LOCATIONS, makeStory } from "./fakes";

// A story with generated actors and props, as the studio writes it.
function generatedStory() {
  const s = makeStory();
  const model = { url: "/m/hagrid.glb", clips: ["/m/hagrid-clips.glb"], uses: { idle: "Idle", talk: "Talking", "hands over the coins": "Hand_Over" }, height: 3.4 };
  s.actors.harry = { ...s.actors.harry, model };
  s.props = { coins: { url: "/m/coins.glb", size: 0.2, held: true } };
  s.scenes.s1.beats = [
    { take: "coins", actor: "harry" },
    { perform: "harry", use: "hands over the coins" },
    { give: "coins", from: "harry", to: "ron" },
    { put: "coins", at: "a" },
  ];
  return s;
}

describe("generated assets", () => {
  it("accepts generated actors, props and beats", () => {
    expect(validateStory(parseStory(generatedStory()), LOCATIONS)).toEqual([]);
  });

  it("names a clip, prop or model that does not exist", () => {
    const s = generatedStory();
    s.scenes.s1.beats.push({ perform: "harry", use: "dances" }, { give: "wand", from: "harry", to: "ron" }, { perform: "ron", use: "talk" });
    const messages = validateStory(parseStory(s), LOCATIONS).map((i) => i.message);
    expect(messages.some((m) => m.includes('no clip for "dances"'))).toBe(true);
    expect(messages.some((m) => m.includes('unknown prop "wand"'))).toBe(true);
    expect(messages.some((m) => m.includes('"ron" has no generated model'))).toBe(true);
  });

  it("plays perform and prop beats on the stage", async () => {
    const stage = new FakeStage();
    const story = parseStory(generatedStory());
    await new Director(story, stage, new FakeHud([], [])).playScene(story.scenes.s1, { fresh: true });
    expect(stage.log.filter((l) => /^(take|perform|give|put)/.test(l))).toEqual([
      "take:harry:coins",
      "perform:harry:hands over the coins",
      "give:coins:harry->ron",
      "put:coins@a",
    ]);
  });

  it("builds a generated set's location info with the usual spots", () => {
    const loc = generatedLocation("inn", "The Inn", { indoor: true, size: [10, 8], floor: "#5a4030", wall: "#7a6a5a", light: "night", pieces: [] });
    expect(loc.info.marks).toContain("auto_1");
    expect(loc.info.marks).toContain("crowd_10");
  });
});
