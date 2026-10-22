import { writeFileSync } from "node:fs";
import { z } from "zod";
import { ManifestSchema } from "../src/engine/assets/manifest";
import { MUSIC_NAMES, SFX_NAMES } from "../src/engine/audio/AudioEngine";
import { ANIM_CLIPS, CAMERA_SHOTS, FX_KINDS } from "../src/engine/story/schema";
import { LOCATIONS, MANIFEST } from "../src/locations";
import { AUTO_MARKS } from "../src/locations/kit";

// Writes catalog.json (what the pipeline can stage, resolved from the asset
// manifest and the engine) and manifest.schema.json (for editing the manifest).
// Usage: npm run catalog
const catalog = {
  defaultScenery: MANIFEST.defaults.scenery,
  // In manifest order: earlier sceneries win keyword ties, so specific ones go first.
  locations: Object.fromEntries(
    MANIFEST.sceneries.map((s) => {
      const l = LOCATIONS[s.id];
      return [s.id, { title: s.title, keywords: s.keywords, marks: l.info.marks, props: l.info.props }];
    }),
  ),
  autoMarks: AUTO_MARKS,
  characters: Object.fromEntries(MANIFEST.characters.map((c) => [c.id, { names: c.names, spec: c.spec }])),
  creatures: Object.fromEntries(MANIFEST.creatures.map((c) => [c.id, { words: c.words, spec: c.spec }])),
  actions: MANIFEST.actions,
  sounds: MANIFEST.sounds,
  clips: ANIM_CLIPS,
  cameraShots: CAMERA_SHOTS,
  fx: FX_KINDS,
  sfx: SFX_NAMES,
  music: MUSIC_NAMES,
};
writeFileSync("catalog.json", JSON.stringify(catalog, null, 2) + "\n");
const schema = z.toJSONSchema(ManifestSchema, { io: "input", unrepresentable: "any" });
writeFileSync("assets/manifest.schema.json", JSON.stringify({ title: "Novel engine asset manifest", ...schema }, null, 2) + "\n");
console.log(`wrote catalog.json (${Object.keys(catalog.locations).length} sceneries, ${Object.keys(catalog.characters).length} characters) and assets/manifest.schema.json`);
