import { BeatSchema, type Beat } from "./schema";

// Action assets as the engine uses them (the manifest's "actions").
export interface ActionDef {
  id: string;
  params: readonly ("actor" | "target" | "object")[];
  steps: readonly unknown[];
  text: string;
  label: string;
  opposite?: string;
}

export type ActionRegistry = Readonly<Record<string, ActionDef>>;

export interface ActionArgs {
  actor: string;
  target?: string;
  object?: string;
}

function fill(value: unknown, args: ActionArgs): unknown {
  if (typeof value === "string") {
    if (value === "$actor") return args.actor;
    if (value === "$target") return args.target;
    if (value === "$object") return args.object;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, args));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, args)]));
  return value;
}

// The beats an action expands to for these parameters.
export function expandAction(def: ActionDef, args: ActionArgs): Beat[] {
  return def.steps.map((step) => BeatSchema.parse(fill(step, args)));
}

export function actionText(template: string, names: { actor?: string; target?: string; object?: string }): string {
  return template.replace(/\{(actor|target|object)\}/g, (_, k: "actor" | "target" | "object") => names[k] ?? "");
}
