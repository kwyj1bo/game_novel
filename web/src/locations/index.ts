import type { LocationDef } from "../engine/world/Location";
import type { LocationRegistryInfo } from "../engine/story/validate";
import { fluffyRoom } from "./fluffyRoom";

export const LOCATIONS: Record<string, LocationDef> = Object.fromEntries([fluffyRoom].map((l) => [l.id, l]));

export const LOCATION_INFO: LocationRegistryInfo = Object.fromEntries(Object.values(LOCATIONS).map((l) => [l.id, l.info]));
