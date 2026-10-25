import { z } from "zod";

// A preset builds a whole 3D place from a few words: its type, size, light,
// colours and props. Manifest sceneries and generated places both use it.

export const PRESET_TYPES = [
  // indoor
  "room", "hall", "tavern", "library", "kitchen", "bedroom", "cellar", "classroom", "shop", "chapel",
  // outdoor
  "forest", "field", "street", "village", "shore", "lake", "mountain", "garden", "cave", "deck",
] as const;
export type PresetType = (typeof PRESET_TYPES)[number];

export const PROP_KINDS = [
  "tree", "pine", "bush", "rock", "house", "fence", "lamp_post", "table", "chair", "bed", "bookshelf",
  "barrel", "crate", "fireplace", "candle", "rug", "pillar", "well", "boat", "stall", "pew", "desk",
  "mast", "cart",
] as const;

export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const PresetSchema = z
  .object({
    type: z.enum(PRESET_TYPES),
    // Floor size in metres (width, depth).
    size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    height: z.number().positive().optional(),
    time: z.enum(["day", "dusk", "night"]).default("day"),
    wall: Color.optional(),
    // A material (wood, flagstone, cobble, tile, dirt, deck) or a ground colour.
    floor: z.union([z.enum(["wood", "flagstone", "cobble", "tile", "dirt", "deck"]), Color]).optional(),
    props: z.array(z.object({ kind: z.enum(PROP_KINDS), count: z.number().int().positive().default(1) }).strict()).default([]),
    seed: z.number().int().default(1),
  })
  .strict();
export type Preset = z.infer<typeof PresetSchema>;
