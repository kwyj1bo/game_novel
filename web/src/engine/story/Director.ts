import type { Beat, Scene, Story } from "./schema";
import type { Hud, Stage } from "./ports";

export class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

// Plays one scene's beats against the stage and HUD.
// In instant mode every beat lands in its final state with no time passing:
// used to rebuild a scene up to its choice when the player retries.
export class Director {
  private generation = 0;

  constructor(
    private readonly story: Story,
    private readonly stage: Stage,
    private readonly hud: Hud,
  ) {}

  // Invalidates any scene currently playing; its next beat throws Aborted.
  abort(): void {
    this.generation++;
  }

  async setup(scene: Scene, fresh: boolean): Promise<void> {
    if (fresh || this.stage.currentLocation() !== scene.location) {
      this.stage.clearActors();
      await this.stage.loadLocation(scene.location);
    }
    for (const id of this.presentActors()) {
      if (!(id in scene.cast)) this.stage.removeActor(id);
    }
    for (const [id, at] of Object.entries(scene.cast)) {
      if (!this.stage.hasActor(id)) this.stage.placeActor(id, this.story.actors[id], at);
    }
    this.stage.resetLook();
  }

  async playScene(scene: Scene, opts: { instant?: boolean; fresh?: boolean } = {}): Promise<void> {
    const gen = this.generation;
    await this.setup(scene, !!opts.fresh);
    if (!opts.instant && scene.title) await this.hud.sceneCard(scene.title);
    for (const beat of scene.beats) {
      if (gen !== this.generation) throw new Aborted();
      await this.play(beat, !!opts.instant);
    }
    if (gen !== this.generation) throw new Aborted();
  }

  private presentActors(): string[] {
    return Object.keys(this.story.actors).filter((id) => this.stage.hasActor(id));
  }

  async play(beat: Beat, instant: boolean): Promise<void> {
    const s = this.stage;
    if ("together" in beat) {
      await Promise.all(beat.together.map((b) => this.play(b, instant)));
      return;
    }
    if ("say" in beat) {
      if (instant) return;
      const spec = this.story.actors[beat.say];
      if (beat.anim) void s.playAnim(beat.say, beat.anim, false, false);
      s.setSpeaking(beat.say, true);
      try {
        await this.hud.showLine(
          { id: beat.say, name: beat.as ?? spec.name, color: beat.color ?? spec.subtitleColor, voice: spec.voice },
          beat.text,
          beat.mood,
        );
      } finally {
        s.setSpeaking(beat.say, false);
      }
      return;
    }
    if ("narrate" in beat) {
      if (!instant) await this.hud.showLine(null, beat.narrate);
      return;
    }
    if ("move" in beat) {
      const p = s.moveActor(beat.move, beat.to, !!beat.run, instant);
      if (!beat.async || instant) await p;
      return;
    }
    if ("look" in beat) return s.lookAt(beat.look, beat.at, instant);
    if ("anim" in beat) {
      // Transient gestures carry no lasting state, so instant mode skips them.
      if (instant && !beat.hold) return;
      const p = s.playAnim(beat.anim, beat.clip, !!beat.hold, instant);
      if (!beat.async || instant) await p;
      return;
    }
    if ("camera" in beat) {
      await s.camera(beat.camera, beat.on, beat.with, instant ? 0 : (beat.ms ?? 900));
      return;
    }
    if ("fx" in beat) {
      if (instant) return;
      const p = s.fx(beat.fx, beat);
      if (!beat.async) await p;
      return;
    }
    if ("wait" in beat) {
      if (!instant) await sleep(beat.wait);
      return;
    }
    if ("sfx" in beat) {
      if (!instant) s.sfx(beat.sfx);
      return;
    }
    if ("music" in beat) return s.music(beat.music);
    if ("prop" in beat) return s.setProp(beat.prop, beat.state);
    if ("spawn" in beat) {
      if (s.hasActor(beat.spawn)) s.removeActor(beat.spawn);
      s.placeActor(beat.spawn, this.story.actors[beat.spawn], beat.at);
      return;
    }
    if ("despawn" in beat) return s.removeActor(beat.despawn);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
