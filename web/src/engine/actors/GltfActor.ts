import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ActorSpec, AnimClip } from "../story/schema";
import { Actor } from "./Actor";
import { buildClip, buildRig } from "./procedural";

const loader = new GLTFLoader();
const files = new Map<string, Promise<GLTF>>();

// Each GLB is fetched once; actors and props clone what they need.
export function loadGltf(url: string): Promise<GLTF> {
  if (!files.has(url)) files.set(url, loader.loadAsync(url));
  return files.get(url)!;
}

// Mixamo bones are named "mixamorigRightHand" (or "mixamorig:RightHand").
const boneKey = (name: string) => name.replace(/^mixamorig:?/i, "").toLowerCase();
const SOCKETS: Record<string, string> = { hand_r: "righthand", hand_l: "lefthand", head: "head", hips: "hips" };
const FADE = 0.25;

interface Performance {
  action: THREE.AnimationAction;
  hold: boolean;
  resolve: () => void;
}

// A character with a skeleton and named clips. Locomotion and talking pick
// their own clip (idle, walk, talk); `perform` plays the clip the story names
// for a use. Subclasses supply the body and the clips.
export abstract class ClipActor extends Actor {
  readonly ready: Promise<void>;
  protected readonly uses: Record<string, string>;
  private readonly h: number;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly bones = new Map<string, THREE.Object3D>();
  private base: { use: string; action: THREE.AnimationAction } | null = null;
  private performance: Performance | null = null;
  private heldAction: THREE.AnimationAction | null = null;

  constructor(id: string, spec: ActorSpec, uses: Record<string, string>, height: number) {
    super(id, spec);
    this.uses = uses;
    this.h = height;
    this.ready = Promise.resolve().then(() => this.load()).catch((e) => console.error(`could not load ${id}:`, e));
  }

  // The body (feet at y = 0 when `scaled` is false) and its clips.
  protected abstract body(): Promise<{ body: THREE.Object3D; clips: THREE.AnimationClip[]; scaled: boolean }>;

  get height(): number {
    return this.h;
  }

  // Procedural clip names ("nod", "point") play the generated clip for that use, if any.
  protected clipDuration(_clip: AnimClip): number {
    return 0.01;
  }

  override play(name: AnimClip, hold: boolean, instant: boolean): Promise<void> {
    return this.uses[name] ? this.perform(name, hold, instant) : Promise.resolve();
  }

  perform(use: string, hold: boolean, instant: boolean): Promise<void> {
    this.endPerformance();
    const clip = this.clipFor(use);
    if (!clip || !this.mixer) return Promise.resolve();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    if (instant) {
      if (hold) this.holdPose(action);
      return Promise.resolve();
    }
    action.fadeIn(FADE).play();
    this.base?.action.fadeOut(FADE);
    return new Promise((resolve) => {
      this.performance = { action, hold, resolve };
    });
  }

  private async load(): Promise<void> {
    const { body, clips, scaled } = await this.body();
    if (!scaled) {
      const box = new THREE.Box3().setFromObject(body);
      const scale = this.h / Math.max(0.01, box.max.y - box.min.y);
      body.scale.setScalar(scale);
      body.position.y = -box.min.y * scale;
    }
    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      if ((o as THREE.Bone).isBone) this.bones.set(boneKey(o.name), o);
    });
    this.root.add(body);
    this.mixer = new THREE.AnimationMixer(body);
    this.mixer.addEventListener("finished", (e) => this.onFinished(e.action as THREE.AnimationAction));
    for (const c of clips) this.clips.set(c.name, c);
  }

  private clipFor(use: string): THREE.AnimationClip | undefined {
    const name = this.uses[use];
    if (!name) return undefined;
    // Exported clip names sometimes carry a prefix ("Armature|Walking").
    return this.clips.get(name) ?? [...this.clips.values()].find((c) => c.name.endsWith(name));
  }

  private onFinished(action: THREE.AnimationAction): void {
    const p = this.performance;
    if (!p || p.action !== action) return;
    this.performance = null;
    if (p.hold) this.holdPose(action);
    else {
      action.fadeOut(FADE);
      this.base = null; // the next frame fades the right base clip back in
    }
    p.resolve();
  }

  private holdPose(action: THREE.AnimationAction): void {
    this.heldAction?.stop();
    this.heldAction = action;
    action.paused = false;
    action.play();
    action.time = action.getClip().duration;
  }

  private endPerformance(): void {
    if (this.performance) {
      const p = this.performance;
      this.performance = null;
      p.action.fadeOut(FADE);
      p.resolve();
    }
    if (this.heldAction) {
      this.heldAction.fadeOut(FADE);
      this.heldAction = null;
    }
  }

  // Walking, talking or standing: the base clip under any performance.
  protected pose(dt: number): void {
    if (!this.mixer) return;
    const use = this.speed > 0.25 ? "walk" : this.speaking && this.uses.talk ? "talk" : "idle";
    if (!this.performance && !this.heldAction && this.base?.use !== use) {
      const clip = this.clipFor(use) ?? this.clipFor("idle");
      if (clip) {
        const action = this.mixer.clipAction(clip);
        action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE).play();
        if (this.base && this.base.action !== action) this.base.action.fadeOut(FADE);
        this.base = { use, action };
      }
    }
    if (this.base && use === "walk") this.base.action.timeScale = Math.max(0.6, this.speed / this.walkSpeed());
    this.mixer.update(dt);
  }

  override socket(name: string): THREE.Object3D {
    return this.bones.get(SOCKETS[name] ?? name) ?? this.root;
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    const head = this.bones.get("head");
    if (head) return head.getWorldPosition(out);
    return this.root.localToWorld(out.set(0, this.height * 0.93, 0));
  }

  castPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.socket("hand_r").getWorldPosition(out);
  }

  override dispose(): void {
    this.endPerformance();
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}

// A generated, rigged GLB and the GLB files holding its clips.
export class GltfActor extends ClipActor {
  constructor(id: string, spec: ActorSpec) {
    super(id, spec, spec.model!.uses, spec.model!.height);
  }

  protected async body() {
    const m = this.spec.model!;
    const gltf = await loadGltf(m.url);
    const files = await Promise.all(m.clips.map(loadGltf));
    return { body: cloneSkinned(gltf.scene), clips: [...gltf.animations, ...files.flatMap((f) => f.animations)], scaled: false };
  }
}

// A character the studio's model built: shapes on a skeleton, keyframe clips.
export class BuiltActor extends ClipActor {
  constructor(id: string, spec: ActorSpec) {
    super(id, spec, spec.built!.uses, spec.built!.rig.height);
  }

  protected async body() {
    const b = this.spec.built!;
    const { root, bones } = buildRig(b.rig, b.parts);
    const hipsY = bones.get("hips")!.position.y;
    return { body: root, clips: Object.entries(b.clips).map(([name, c]) => buildClip(name, c, hipsY)), scaled: true };
  }
}
