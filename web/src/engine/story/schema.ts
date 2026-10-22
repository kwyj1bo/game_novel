import { z } from "zod";

// A "target" is either a named mark in the location, an actor id, or a raw [x, z] floor point.
const Target = z.union([z.string(), z.tuple([z.number(), z.number()])]);
export type Target = z.infer<typeof Target>;

export const ANIM_CLIPS = [
  "idle",
  "wave",
  "point",
  "cast",
  "nod",
  "shake",
  "cower",
  "fall",
  "kneel",
  "jump",
  "struggle",
  "reach",
  "drink",
  "celebrate",
  "play_flute",
  "laugh",
  "unwrap",
  "crumble",
  // creature clips
  "sleep",
  "wake",
  "lunge",
  "roar",
] as const;
export type AnimClip = (typeof ANIM_CLIPS)[number];

export const CAMERA_SHOTS = ["wide", "close", "medium", "two", "over", "low", "high", "orbit", "pov"] as const;
export type CameraShot = (typeof CAMERA_SHOTS)[number];

export const FX_KINDS = [
  "spell",
  "burst",
  "fire",
  "smoke",
  "flash",
  "sparkles",
  "shake",
  "fade_out",
  "fade_in",
  "red_out",
] as const;
export type FxKind = (typeof FX_KINDS)[number];

const SayBeat = z.object({
  say: z.string(),
  text: z.string().min(1),
  // Speak through this actor under another name (a voice from offstage, a possessed host).
  as: z.string().optional(),
  color: z.string().optional(),
  anim: z.enum(ANIM_CLIPS).optional(),
  mood: z.enum(["calm", "urgent", "scared", "angry", "whisper"]).optional(),
});
const NarrateBeat = z.object({ narrate: z.string().min(1) });
const MoveBeat = z.object({
  move: z.string(),
  to: Target,
  run: z.boolean().optional(),
  // Move without waiting for arrival.
  async: z.boolean().optional(),
});
const LookBeat = z.object({ look: z.string(), at: Target });
const AnimBeat = z.object({
  anim: z.string(),
  clip: z.enum(ANIM_CLIPS),
  hold: z.boolean().optional(),
  async: z.boolean().optional(),
});
const CameraBeat = z.object({
  camera: z.enum(CAMERA_SHOTS),
  on: Target.optional(),
  with: Target.optional(),
  ms: z.number().nonnegative().optional(),
});
const FxBeat = z.object({
  fx: z.enum(FX_KINDS),
  from: Target.optional(),
  to: Target.optional(),
  at: Target.optional(),
  color: z.string().optional(),
  ms: z.number().nonnegative().optional(),
  async: z.boolean().optional(),
});
const WaitBeat = z.object({ wait: z.number().nonnegative() });
const SfxBeat = z.object({ sfx: z.string() });
const MusicBeat = z.object({ music: z.string() });
const PropBeat = z.object({ prop: z.string(), state: z.string() });
const SpawnBeat = z.object({ spawn: z.string(), at: Target });
const DespawnBeat = z.object({ despawn: z.string() });

export type Beat =
  | z.infer<typeof SayBeat>
  | z.infer<typeof NarrateBeat>
  | z.infer<typeof MoveBeat>
  | z.infer<typeof LookBeat>
  | z.infer<typeof AnimBeat>
  | z.infer<typeof CameraBeat>
  | z.infer<typeof FxBeat>
  | z.infer<typeof WaitBeat>
  | z.infer<typeof SfxBeat>
  | z.infer<typeof MusicBeat>
  | z.infer<typeof PropBeat>
  | z.infer<typeof SpawnBeat>
  | z.infer<typeof DespawnBeat>
  | { together: Beat[] };

export const BeatSchema: z.ZodType<Beat> = z.lazy(() =>
  z.union([
    SayBeat.strict(),
    NarrateBeat.strict(),
    MoveBeat.strict(),
    LookBeat.strict(),
    AnimBeat.strict(),
    CameraBeat.strict(),
    FxBeat.strict(),
    WaitBeat.strict(),
    SfxBeat.strict(),
    MusicBeat.strict(),
    PropBeat.strict(),
    SpawnBeat.strict(),
    DespawnBeat.strict(),
    z.object({ together: z.array(BeatSchema).min(1) }).strict(),
  ]),
);

export const ChoiceOptionSchema = z
  .object({
    label: z.string().min(1),
    correct: z.boolean(),
    goto: z.string(),
  })
  .strict();

export const ChoiceSchema = z
  .object({
    prompt: z.string().min(1),
    seconds: z.number().positive().default(10),
    options: z.array(ChoiceOptionSchema).min(2).max(3),
  })
  .strict();

export const EndingSchema = z
  .object({
    kind: z.enum(["death", "failure", "victory"]),
    title: z.string(),
    text: z.string(),
  })
  .strict();

export const SceneSchema = z
  .object({
    title: z.string().optional(),
    location: z.string(),
    // actor id -> starting target (mark or [x, z]).
    cast: z.record(z.string(), Target).default({}),
    beats: z.array(BeatSchema).default([]),
    // Exactly one of these ends the scene.
    choice: ChoiceSchema.optional(),
    goto: z.string().optional(),
    ending: EndingSchema.optional(),
  })
  .strict()
  .refine((s) => [s.choice, s.goto, s.ending].filter(Boolean).length === 1, {
    message: "scene must end with exactly one of: choice, goto, ending",
  });

export const ActorSpecSchema = z
  .object({
    name: z.string(),
    kind: z.enum(["human", "dog3", "troll", "owl", "cat"]).default("human"),
    height: z.number().positive().default(1.6),
    robe: z.string().default("#222222"),
    trim: z.string().optional(),
    skin: z.string().default("#e8c4a0"),
    hair: z.string().default("#3a2a1a"),
    hairStyle: z.enum(["messy", "short", "long", "bushy", "bun", "bald", "turban", "ginger_mop"]).default("short"),
    eyes: z.string().default("#3a5a2a"),
    glasses: z.enum(["none", "round", "halfmoon", "square"]).default("none"),
    beard: z.enum(["none", "short", "long"]).default("none"),
    // Students wear the school jumper and shirt under the robe.
    outfit: z.enum(["student", "adult"]).default("student"),
    scar: z.boolean().default(false),
    voice: z.number().default(1),
    subtitleColor: z.string().default("#ffffff"),
  })
  .strict();

export const StorySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
    start: z.string(),
    actors: z.record(z.string(), ActorSpecSchema),
    scenes: z.record(z.string(), SceneSchema),
  })
  .strict();

export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;
export type Choice = z.infer<typeof ChoiceSchema>;
export type Ending = z.infer<typeof EndingSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type ActorSpec = z.infer<typeof ActorSpecSchema>;
export type Story = z.infer<typeof StorySchema>;

export function parseStory(raw: unknown): Story {
  return StorySchema.parse(raw);
}

// Helpers to narrow beats without repeating `in` checks everywhere.
export function beatKind(beat: Beat): string {
  return Object.keys(beat).find((k) => BEAT_KEYS.has(k)) ?? "unknown";
}

const BEAT_KEYS = new Set([
  "say",
  "narrate",
  "move",
  "look",
  "anim",
  "camera",
  "fx",
  "wait",
  "sfx",
  "music",
  "prop",
  "spawn",
  "despawn",
  "together",
]);
