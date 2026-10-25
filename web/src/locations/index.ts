import { ManifestSchema, type Manifest } from "../engine/assets/manifest";
import type { ActionRegistry } from "../engine/story/actions";
import type { Story } from "../engine/story/schema";
import type { LocationRegistryInfo } from "../engine/story/validate";
import type { LocationDef } from "../engine/world/Location";
import manifestJson from "../../assets/manifest.json";
import { castleCorridor } from "./castleCorridor";
import { chessboard } from "./chessboard";
import { devilsSnare } from "./devilsSnare";
import { fluffyRoom } from "./fluffyRoom";
import { flyingKeys } from "./flyingKeys";
import { modelLocation, presetLocation } from "./generic";
import { girlsBathroom } from "./girlsBathroom";
import { mirrorChamber } from "./mirrorChamber";
import { potionsRoom } from "./potionsRoom";

// Hand-built locations a manifest scenery can point at with "code".
const CODE: Record<string, LocationDef> = Object.fromEntries(
  [fluffyRoom, devilsSnare, flyingKeys, chessboard, potionsRoom, mirrorChamber, castleCorridor, girlsBathroom].map((l) => [l.id, l]),
);

export const MANIFEST: Manifest = ManifestSchema.parse(manifestJson);

// One location per manifest scenery, whatever builds it.
export function locationsFromManifest(m: Manifest): Record<string, LocationDef> {
  const out: Record<string, LocationDef> = {};
  for (const s of m.sceneries) {
    if (s.code) {
      const def = CODE[s.code];
      if (!def) throw new Error(`scenery ${s.id}: no hand-built location "${s.code}"`);
      out[s.id] = { ...def, id: s.id, title: s.title, info: { ...def.info, keywords: s.keywords } };
    } else if (s.preset) {
      out[s.id] = presetLocation(s);
    } else {
      out[s.id] = modelLocation(s);
    }
  }
  return out;
}

export const LOCATIONS: Record<string, LocationDef> = locationsFromManifest(MANIFEST);

// Action assets by id, for "act" beats.
export const ACTIONS: ActionRegistry = Object.fromEntries(MANIFEST.actions.map((a) => [a.id, a]));

export const LOCATION_INFO: LocationRegistryInfo = Object.fromEntries(Object.values(LOCATIONS).map((l) => [l.id, l.info]));

// A story's own places, built from their presets.
export function storyLocations(story: Story): Record<string, LocationDef> {
  return Object.fromEntries(Object.entries(story.sceneries ?? {}).map(([id, s]) => [id, presetLocation({ id, title: s.title, keywords: [s.title], preset: s.preset })]));
}
