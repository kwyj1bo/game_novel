import { describe, expect, it } from "vitest";
import { parseStory } from "../../src/engine/story/schema";
import { validateStory } from "../../src/engine/story/validate";
import { storyLocations } from "../../src/locations";
import { LOCATIONS, makeStory } from "./fakes";

// A story can bring its own place, built from a preset (e.g. one generated for its book).
const withOwnPlace = () =>
  parseStory({
    ...makeStory(),
    sceneries: { gen_harbour: { title: "The Harbour", preset: { type: "shore", time: "dusk", props: [{ kind: "boat", count: 2 }] } } },
  });

describe("story sceneries", () => {
  it("builds a 3D place for each scenery the story brings", () => {
    const own = storyLocations(withOwnPlace());
    expect(Object.keys(own)).toEqual(["gen_harbour"]);
    expect(own.gen_harbour.title).toBe("The Harbour");
    expect(own.gen_harbour.info.marks.length).toBeGreaterThan(0);
  });

  it("lets scenes use the story's own place", () => {
    const story = withOwnPlace();
    const mark = storyLocations(story).gen_harbour.info.marks[0];
    story.scenes.s1.location = "gen_harbour";
    story.scenes.s1.cast = { harry: mark, ron: mark };
    const info = { ...LOCATIONS, gen_harbour: storyLocations(story).gen_harbour.info };
    expect(validateStory(story, LOCATIONS).some((i) => i.message.includes("gen_harbour"))).toBe(true);
    expect(validateStory(story, info).filter((i) => i.scene === "s1" && i.message.includes("location"))).toEqual([]);
  });

  it("rejects a scenery without a valid preset", () => {
    expect(() => parseStory({ ...makeStory(), sceneries: { x: { title: "X", preset: { type: "spaceship" } } } })).toThrow();
  });
});
