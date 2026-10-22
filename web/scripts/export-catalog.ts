import { readFileSync, writeFileSync } from "node:fs";
import { MUSIC_NAMES, SFX_NAMES } from "../src/engine/audio/AudioEngine";
import { ANIM_CLIPS, CAMERA_SHOTS, FX_KINDS } from "../src/engine/story/schema";
import { LOCATIONS } from "../src/locations";
import { AUTO_MARKS } from "../src/locations/kit";

// Writes catalog.json: the assets the engine can stage, for the novel pipeline.
// Usage: npm run catalog
const stories = ["troll", "trapdoor"].map((n) => JSON.parse(readFileSync(`src/content/hp/${n}.story.json`, "utf8")));
const characters: Record<string, unknown> = {};
for (const s of stories) Object.assign(characters, s.actors);

const catalog = {
  locations: Object.fromEntries(
    Object.values(LOCATIONS).map((l) => [l.id, { title: l.title, keywords: l.info.keywords ?? [], marks: l.info.marks, props: l.info.props }]),
  ),
  autoMarks: AUTO_MARKS,
  // Known characters with ready-made looks, keyed by the name used in text.
  characters,
  // Creature assets and the words that refer to them.
  creatures: { dog3: ["dog", "hound", "three-headed"], troll: ["troll", "ogre"] },
  clips: ANIM_CLIPS,
  cameraShots: CAMERA_SHOTS,
  fx: FX_KINDS,
  sfx: SFX_NAMES,
  music: MUSIC_NAMES,
};
writeFileSync("catalog.json", JSON.stringify(catalog, null, 2) + "\n");
console.log(`wrote catalog.json (${Object.keys(catalog.locations).length} locations, ${Object.keys(characters).length} characters)`);
