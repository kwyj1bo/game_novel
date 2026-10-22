import type { EndingAction, Hud, Stage } from "../../src/engine/story/ports";
import type { Choice, Ending, Story } from "../../src/engine/story/schema";

// Records everything the director does so tests can assert on it.
export class FakeStage implements Stage {
  log: string[] = [];
  location: string | null = null;
  actors = new Map<string, unknown>();
  props = new Map<string, string>();

  async loadLocation(id: string) {
    this.location = id;
    this.props.clear();
    this.log.push(`load:${id}`);
  }
  currentLocation() {
    return this.location;
  }
  hasActor(id: string) {
    return this.actors.has(id);
  }
  placeActor(id: string, _spec: unknown, at: unknown) {
    this.actors.set(id, at);
    this.log.push(`place:${id}@${String(at)}`);
  }
  removeActor(id: string) {
    this.actors.delete(id);
    this.log.push(`remove:${id}`);
  }
  clearActors() {
    this.actors.clear();
  }
  async moveActor(id: string, to: unknown, _run: boolean, instant: boolean) {
    this.actors.set(id, to);
    this.log.push(`move:${id}->${String(to)}${instant ? "!" : ""}`);
  }
  lookAt() {}
  async playAnim(id: string, clip: string) {
    this.log.push(`anim:${id}:${clip}`);
  }
  setSpeaking() {}
  async camera(shot: string) {
    this.log.push(`camera:${shot}`);
  }
  async fx(kind: string) {
    this.log.push(`fx:${kind}`);
  }
  setProp(prop: string, state: string) {
    this.props.set(prop, state);
    this.log.push(`prop:${prop}=${state}`);
  }
  sfx() {}
  music() {}
  resetLook() {}
}

// Answers choices and endings from scripted queues.
export class FakeHud implements Hud {
  lines: string[] = [];
  endings: Ending[] = [];
  constructor(
    private choices: number[],
    private endingActions: EndingAction[],
  ) {}
  async showTitle(_s: Story) {}
  async sceneCard() {}
  async showLine(_speaker: unknown, text: string) {
    this.lines.push(text);
  }
  hideLine() {}
  async showChoice(_c: Choice) {
    const next = this.choices.shift();
    if (next === undefined) throw new Error("no more scripted choices");
    return next;
  }
  async showEnding(ending: Ending): Promise<EndingAction> {
    this.endings.push(ending);
    const next = this.endingActions.shift();
    if (next === undefined) throw new StopRun();
    return next;
  }
}

export class StopRun extends Error {}

export const LOCATIONS = {
  hall: { marks: ["a", "b", "door"], props: { door: ["open", "closed"] } },
  pit: { marks: ["a", "b"], props: {} },
};

export function makeStory(): Story {
  return {
    id: "t",
    title: "Test",
    start: "s1",
    actors: {
      harry: actor("Harry"),
      ron: actor("Ron"),
    },
    scenes: {
      s1: {
        location: "hall",
        cast: { harry: "a", ron: "b" },
        beats: [{ say: "harry", text: "Hi" }, { prop: "door", state: "open" }],
        goto: "s2",
      },
      s2: {
        location: "hall",
        cast: { harry: "a", ron: "b" },
        beats: [{ move: "harry", to: "door" }],
        choice: {
          prompt: "Which?",
          seconds: 5,
          options: [
            { label: "Right", correct: true, goto: "ok" },
            { label: "Wrong", correct: false, goto: "bad" },
          ],
        },
      },
      bad: {
        location: "hall",
        cast: { harry: "a" },
        beats: [{ anim: "harry", clip: "fall" }],
        ending: { kind: "death", title: "Dead", text: "x" },
      },
      ok: {
        location: "pit",
        cast: { harry: "a" },
        beats: [{ narrate: "Down we go" }],
        ending: { kind: "victory", title: "Win", text: "y" },
      },
    },
  };
}

function actor(name: string) {
  return {
    name,
    kind: "human" as const,
    height: 1.6,
    robe: "#000",
    skin: "#fff",
    hair: "#000",
    hairStyle: "short" as const,
    eyes: "#000",
    glasses: "none" as const,
    beard: "none" as const,
    outfit: "student" as const,
    hat: "none" as const,
    scar: false,
    voice: 1,
    subtitleColor: "#fff",
  };
}
