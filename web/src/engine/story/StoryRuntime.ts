import { Aborted, Director } from "./Director";
import type { Hud, Stage } from "./ports";
import type { ChoiceOption, Ending, Story } from "./schema";

export type RuntimeEvent =
  | { type: "scene"; id: string }
  // checkpoint: the scene that entered the current location, a safe place to resume.
  | { type: "choice"; scene: string; checkpoint: string }
  | { type: "chosen"; scene: string; option: ChoiceOption; timedOut: boolean }
  | { type: "ending"; scene: string; ending: Ending };

// The game loop over the story graph: scene -> choice -> branch -> ending -> retry.
export class StoryRuntime {
  readonly director: Director;
  private listeners: ((e: RuntimeEvent) => void)[] = [];
  private lastChoiceScene: string | null = null;
  // Scenes played since the last location change; replayed instantly on retry
  // so props and positions they set are restored.
  private trail: string[] = [];
  currentScene: string | null = null;

  constructor(
    private readonly story: Story,
    stage: Stage,
    private readonly hud: Hud,
  ) {
    this.director = new Director(story, stage, hud);
  }

  on(fn: (e: RuntimeEvent) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private emit(e: RuntimeEvent): void {
    for (const l of this.listeners) l(e);
  }

  async start(opts: { skipTitle?: boolean; from?: string } = {}): Promise<void> {
    if (!opts.skipTitle) await this.hud.showTitle(this.story);
    await this.playFrom(opts.from ?? this.story.start, { fresh: true });
  }

  // Runs scenes until the player quits out of an ending screen (which loops back here).
  async playFrom(sceneId: string, opts: { fresh?: boolean; instant?: boolean } = {}): Promise<void> {
    let id = sceneId;
    let fresh = !!opts.fresh;
    let instant = !!opts.instant;
    for (;;) {
      const scene = this.story.scenes[id];
      this.currentScene = id;
      this.emit({ type: "scene", id });
      const prev = this.trail.at(-1);
      if (fresh || !prev || this.story.scenes[prev].location !== scene.location) this.trail = [];
      this.trail.push(id);
      try {
        await this.director.playScene(scene, { instant, fresh });
      } catch (e) {
        if (e instanceof Aborted) return;
        throw e;
      }
      fresh = false;
      instant = false;

      if (scene.choice) {
        this.lastChoiceScene = id;
        this.emit({ type: "choice", scene: id, checkpoint: this.trail[0] ?? id });
        const idx = await this.hud.showChoice(scene.choice);
        const timedOut = idx < 0;
        // Hesitating is a choice too: running out of time takes the wrong path.
        const option = timedOut ? scene.choice.options.find((o) => !o.correct)! : scene.choice.options[idx];
        this.emit({ type: "chosen", scene: id, option, timedOut });
        id = option.goto;
        continue;
      }
      if (scene.goto) {
        id = scene.goto;
        continue;
      }
      const ending = scene.ending!;
      this.emit({ type: "ending", scene: id, ending });
      const canRetry = ending.kind !== "victory" && this.lastChoiceScene !== null;
      const action = await this.hud.showEnding(ending, canRetry);
      if (action === "menu") return;
      if (action === "retry" && canRetry) {
        id = this.lastChoiceScene!;
        const prefix = this.trail.slice(0, this.trail.indexOf(id));
        try {
          for (const [i, pid] of prefix.entries()) {
            await this.director.playScene(this.story.scenes[pid], { instant: true, fresh: i === 0 });
          }
        } catch (e) {
          if (e instanceof Aborted) return;
          throw e;
        }
        this.trail = prefix;
        fresh = prefix.length === 0;
        instant = true;
      } else {
        this.lastChoiceScene = null;
        id = this.story.start;
        fresh = true;
      }
    }
  }
}
