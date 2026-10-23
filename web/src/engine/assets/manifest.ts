import { z } from "zod";
import { ActorSpecSchema } from "../story/schema";

// The asset manifest: everything the engine can put on screen, as data.
// The novel pipeline reads the same file to decide what a chapter can use.
// Adding an asset means adding an entry here (and, for a model, its file).

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

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

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

export const ScenerySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    // Words in narration that mean "we are here".
    keywords: z.array(z.string()).min(1),
    // Exactly one way to build it: a hand-built location in code, a preset, or a glTF model.
    code: z.string().optional(),
    preset: PresetSchema.optional(),
    model: z.string().optional(),
    music: z.string().optional(),
  })
  .strict()
  .refine((s) => [s.code, s.preset, s.model].filter(Boolean).length === 1, { message: "scenery needs exactly one of code, preset, model" });
export type Scenery = z.infer<typeof ScenerySchema>;

export const CharacterAssetSchema = z
  .object({
    id: z.string(),
    // Names a text may use for this character ("Harry", "Harry Potter", "Potter").
    names: z.array(z.string()).min(1),
    spec: ActorSpecSchema.partial().extend({ name: z.string() }),
  })
  .strict();

export const CreatureAssetSchema = z
  .object({
    id: z.string(),
    words: z.array(z.string()).min(1),
    spec: ActorSpecSchema.partial().extend({ name: z.string(), kind: z.enum(["dog3", "troll", "dog", "cat", "owl", "dragon", "centaur", "unicorn"]) }),
  })
  .strict();

// An action is a small piece of choreography with parameters. Its steps are
// story beats in which "$actor", "$target" and "$object" stand for the
// parameters; the engine fills them in when a story says
// {"act": "pat", "actor": "ron", "target": "harry"}.
export const ActionAssetSchema = z
  .object({
    id: z.string(),
    // Verbs in a text that mean this action.
    verbs: z.array(z.string()).default([]),
    // verb -> object word, for verbs that mean this only with that object ("raise" + "wand" = cast).
    with: z.record(z.string(), z.string()).default({}),
    params: z.array(z.enum(["actor", "target", "object"])).default(["actor"]),
    steps: z.array(z.unknown()).min(1),
    // Narration, e.g. "{actor} pats {target} on the head."
    text: z.string(),
    // Choice label addressed to the player, e.g. "Pat {target} on the head".
    label: z.string(),
    // The action that is its direct opposite (for the wrong choice).
    opposite: z.string().optional(),
    // Something a character chooses to do, so it can become a choice
    // (falling or flinching happen to you; opening a door is a decision).
    decision: z.boolean().default(false),
  })
  .strict();
export type ActionAsset = z.infer<typeof ActionAssetSchema>;

export const SoundAssetSchema = z.object({ id: z.string(), words: z.array(z.string()).min(1) }).strict();

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    defaults: z.object({ scenery: z.string() }).strict(),
    sceneries: z.array(ScenerySchema),
    characters: z.array(CharacterAssetSchema).default([]),
    creatures: z.array(CreatureAssetSchema).default([]),
    actions: z.array(ActionAssetSchema).default([]),
    sounds: z.array(SoundAssetSchema).default([]),
  })
  .strict()
  .refine((m) => m.sceneries.some((s) => s.id === m.defaults.scenery), { message: "defaults.scenery must name a scenery" });
export type Manifest = z.infer<typeof ManifestSchema>;
