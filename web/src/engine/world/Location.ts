import type * as THREE from "three";
import type { AudioEngine } from "../audio/AudioEngine";
import type { Particles } from "../fx/Particles";
import type { Actor } from "../actors/Actor";
import type { Timeline } from "../core/Timeline";
import type { LocationInfo } from "../story/validate";

export interface LocationContext {
  particles: Particles;
  audio: AudioEngine;
  timeline: Timeline;
  actor(id: string): Actor | undefined;
}

export interface LocationInstance {
  root: THREE.Object3D;
  marks: Record<string, THREE.Vector3>;
  wide: { pos: THREE.Vector3; look: THREE.Vector3 };
  // Camera is kept inside this box so it never clips through walls.
  bounds: THREE.Box3;
  background: THREE.Color;
  fog: THREE.Fog | THREE.FogExp2 | null;
  environmentIntensity?: number;
  music?: string;
  update(dt: number, t: number): void;
  setProp(prop: string, state: string, instant: boolean): void;
  dispose?(): void;
}

export interface LocationDef {
  id: string;
  title: string;
  // Static description, used by the validator without building any 3D.
  info: LocationInfo;
  build(ctx: LocationContext): LocationInstance;
}
