import type { ActorSpec, AnimClip, CameraShot, Choice, Ending, FxKind, Story, Target } from "./schema";

// The director talks to the world and the UI only through these two ports,
// so story logic runs headless in tests and the renderer can be swapped.

export interface FxOptions {
  from?: Target;
  to?: Target;
  at?: Target;
  color?: string;
  ms?: number;
}

export interface Stage {
  loadLocation(id: string): Promise<void>;
  currentLocation(): string | null;
  hasActor(id: string): boolean;
  placeActor(id: string, spec: ActorSpec, at: Target): void;
  removeActor(id: string): void;
  clearActors(): void;
  moveActor(id: string, to: Target, run: boolean, instant: boolean): Promise<void>;
  lookAt(id: string, at: Target, instant: boolean): void;
  playAnim(id: string, clip: AnimClip, hold: boolean, instant: boolean): Promise<void>;
  setSpeaking(id: string, speaking: boolean): void;
  camera(shot: CameraShot, on: Target | undefined, withTarget: Target | undefined, ms: number): Promise<void>;
  fx(kind: FxKind, opts: FxOptions): Promise<void>;
  setProp(prop: string, state: string): void;
  sfx(name: string): void;
  music(name: string): void;
  resetLook(): void;
}

export interface Speaker {
  id: string;
  name: string;
  color: string;
  voice: number;
}

export type EndingAction = "retry" | "restart" | "menu";

export interface Hud {
  showTitle(story: Story): Promise<void>;
  sceneCard(title: string): Promise<void>;
  // Resolves when the player advances (or auto-advance fires).
  showLine(speaker: Speaker | null, text: string, mood?: string): Promise<void>;
  hideLine(): void;
  // Resolves with the chosen index, or -1 when the timer runs out.
  showChoice(choice: Choice): Promise<number>;
  showEnding(ending: Ending, canRetry: boolean): Promise<EndingAction>;
}
