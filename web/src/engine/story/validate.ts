import { expandAction, type ActionRegistry } from "./actions";
import type { Beat, Scene, Story, Target } from "./schema";

// Static facts a location exposes so stories can be checked without a renderer.
export interface LocationInfo {
  marks: readonly string[];
  props: Readonly<Record<string, readonly string[]>>;
  // Words in a text that suggest this place (used by the novel pipeline).
  keywords?: readonly string[];
}

export type LocationRegistryInfo = Readonly<Record<string, LocationInfo>>;

export interface ValidationIssue {
  scene?: string;
  message: string;
}

// Checks the rules the game design depends on:
// - every reference (scene, actor, location, mark, prop state) resolves
// - a choice has exactly one correct option
// - a wrong option is a dead end: its branch reaches an ending without another choice
// - a correct option leads on (never straight into a losing ending)
// - the graph has no cycles and every scene is reachable from the start
export function validateStory(story: Story, locations: LocationRegistryInfo, actions: ActionRegistry = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scenes = story.scenes;

  if (!scenes[story.start]) issues.push({ message: `start scene "${story.start}" does not exist` });

  for (const [id, scene] of Object.entries(scenes)) {
    checkScene(id, scene, story, locations, issues, actions);
  }

  for (const [id, scene] of Object.entries(scenes)) {
    if (!scene.choice) continue;
    for (const opt of scene.choice.options) {
      if (!scenes[opt.goto]) continue;
      const branch = walkLinear(opt.goto, scenes);
      if (opt.correct) {
        if (branch.ending && branch.ending.kind !== "victory") {
          issues.push({ scene: id, message: `correct option "${opt.label}" leads to a ${branch.ending.kind} ending` });
        }
      } else {
        if (branch.choiceAt) {
          issues.push({
            scene: id,
            message: `wrong option "${opt.label}" must end the run, but reaches a choice at "${branch.choiceAt}"`,
          });
        } else if (branch.ending?.kind === "victory") {
          issues.push({ scene: id, message: `wrong option "${opt.label}" leads to a victory ending` });
        }
      }
    }
  }

  issues.push(...checkGraph(story));
  return issues;
}

function checkScene(
  id: string,
  scene: Scene,
  story: Story,
  locations: LocationRegistryInfo,
  issues: ValidationIssue[],
  actions: ActionRegistry,
): void {
  const loc = locations[scene.location];
  if (!loc) {
    issues.push({ scene: id, message: `unknown location "${scene.location}"` });
    return;
  }
  const present = new Set(Object.keys(scene.cast));
  const err = (message: string) => issues.push({ scene: id, message });

  const checkActor = (actor: string, where: string) => {
    if (!story.actors[actor]) err(`${where}: unknown actor "${actor}"`);
    else if (!present.has(actor)) err(`${where}: actor "${actor}" is not on stage`);
  };
  const checkTarget = (t: Target | undefined, where: string) => {
    if (t === undefined || Array.isArray(t)) return;
    // An actor who is not on stage cannot be framed or targeted.
    if (!loc.marks.includes(t) && !present.has(t)) {
      err(`${where}: "${t}" is not a mark in ${scene.location} or an actor on stage`);
    }
  };

  for (const [actor, at] of Object.entries(scene.cast)) {
    if (!story.actors[actor]) err(`cast: unknown actor "${actor}"`);
    checkTarget(at, `cast.${actor}`);
  }

  const visit = (beat: Beat, path: string) => {
    if ("together" in beat) return beat.together.forEach((b, i) => visit(b, `${path}.together[${i}]`));
    if ("act" in beat) {
      const def = actions[beat.act];
      if (!def) return err(`${path}: unknown action "${beat.act}"`);
      checkActor(beat.actor, path);
      if (def.params.includes("target")) {
        if (!beat.target) return err(`${path}: action "${beat.act}" needs a target`);
        checkActor(beat.target, path);
      }
      // The expanded steps must be valid in this scene too.
      try {
        expandAction(def, beat).forEach((b, i) => visit(b, `${path}<${beat.act}>[${i}]`));
      } catch (e) {
        err(`${path}: action "${beat.act}" expands to an invalid beat: ${(e as Error).message.slice(0, 120)}`);
      }
      return;
    }
    if ("say" in beat) checkActor(beat.say, path);
    if ("move" in beat) {
      checkActor(beat.move, path);
      checkTarget(beat.to, path);
    }
    if ("look" in beat) {
      checkActor(beat.look, path);
      checkTarget(beat.at, path);
    }
    if ("clip" in beat) checkActor(beat.anim, path);
    if ("camera" in beat) {
      checkTarget(beat.on, path);
      checkTarget(beat.with, path);
    }
    if ("fx" in beat) {
      checkTarget(beat.from, path);
      checkTarget(beat.to, path);
      checkTarget(beat.at, path);
    }
    if ("prop" in beat) {
      const states = loc.props[beat.prop];
      if (!states) err(`${path}: unknown prop "${beat.prop}" in ${scene.location}`);
      else if (!states.includes(beat.state)) err(`${path}: prop "${beat.prop}" has no state "${beat.state}"`);
    }
    if ("spawn" in beat) {
      if (!story.actors[beat.spawn]) err(`${path}: unknown actor "${beat.spawn}"`);
      present.add(beat.spawn);
      checkTarget(beat.at, path);
    }
    if ("despawn" in beat) {
      checkActor(beat.despawn, path);
      present.delete(beat.despawn);
    }
  };
  scene.beats.forEach((b, i) => visit(b, `beats[${i}]`));

  if (scene.choice) {
    const correct = scene.choice.options.filter((o) => o.correct).length;
    if (correct !== 1) err(`choice must have exactly one correct option (has ${correct})`);
    for (const o of scene.choice.options) {
      if (!story.scenes[o.goto]) err(`choice option "${o.label}" goes to unknown scene "${o.goto}"`);
    }
  }
  if (scene.goto && !story.scenes[scene.goto]) err(`goto unknown scene "${scene.goto}"`);
}

// Follows goto links until a choice or an ending.
function walkLinear(
  from: string,
  scenes: Story["scenes"],
): { ending?: Scene["ending"]; choiceAt?: string } {
  const seen = new Set<string>();
  let id: string | undefined = from;
  while (id && scenes[id] && !seen.has(id)) {
    seen.add(id);
    const s: Scene = scenes[id];
    if (s.choice) return { choiceAt: id };
    if (s.ending) return { ending: s.ending };
    id = s.goto;
  }
  return {};
}

export function successors(scene: Scene): string[] {
  if (scene.choice) return scene.choice.options.map((o) => o.goto);
  if (scene.goto) return [scene.goto];
  return [];
}

function checkGraph(story: Story): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const state = new Map<string, "visiting" | "done">();

  const dfs = (id: string, trail: string[]) => {
    const scene = story.scenes[id];
    if (!scene) return;
    const st = state.get(id);
    if (st === "visiting") {
      issues.push({ scene: id, message: `cycle: ${[...trail, id].join(" -> ")}` });
      return;
    }
    if (st === "done") return;
    state.set(id, "visiting");
    for (const next of successors(scene)) dfs(next, [...trail, id]);
    state.set(id, "done");
  };
  dfs(story.start, []);

  for (const id of Object.keys(story.scenes)) {
    if (!state.has(id)) issues.push({ scene: id, message: "scene is unreachable from start" });
  }
  return issues;
}
