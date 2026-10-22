import type { LocationDef } from "../engine/world/Location";
import type { LocationRegistryInfo } from "../engine/story/validate";
import { chessboard } from "./chessboard";
import { devilsSnare } from "./devilsSnare";
import { fluffyRoom } from "./fluffyRoom";
import { flyingKeys } from "./flyingKeys";
import { mirrorChamber } from "./mirrorChamber";
import { potionsRoom } from "./potionsRoom";

export const LOCATIONS: Record<string, LocationDef> = Object.fromEntries(
  [fluffyRoom, devilsSnare, flyingKeys, chessboard, potionsRoom, mirrorChamber].map((l) => [l.id, l]),
);

export const LOCATION_INFO: LocationRegistryInfo = Object.fromEntries(Object.values(LOCATIONS).map((l) => [l.id, l.info]));
