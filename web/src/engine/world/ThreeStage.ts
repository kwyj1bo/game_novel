import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Actor } from "../actors/Actor";
import { createActor } from "../actors/createActor";
import type { AudioEngine } from "../audio/AudioEngine";
import { Timeline } from "../core/Timeline";
import { FxSystem } from "../fx/FxSystem";
import { Particles } from "../fx/Particles";
import { CameraRig, type ShotSubject } from "../render/CameraRig";
import type { FxOptions, Stage } from "../story/ports";
import type { ActorSpec, AnimClip, CameraShot, FxKind, PropModel, Target } from "../story/schema";
import { ClipActor, loadGltf } from "../actors/GltfActor";
import { buildParts } from "../actors/procedural";
import type { LocationContext, LocationDef, LocationInstance } from "./Location";

const FOCUS_LIFT = 1.3;

// The 3D world behind the Stage port: owns the scene, the current location,
// actors, camera, particles and effects, and advances them every frame.
export class ThreeStage implements Stage {
  readonly scene = new THREE.Scene();
  readonly timeline = new Timeline();
  readonly particles = new Particles();
  readonly rig: CameraRig;
  readonly fxs: FxSystem;
  private location: LocationInstance | null = null;
  private locationId: string | null = null;
  private readonly actors = new Map<string, Actor>();
  private readonly explicitLook = new Set<string>();
  // Generated props this story can use, and the ones made so far.
  private propModels: Record<string, PropModel> = {};
  private readonly props = new Map<string, THREE.Object3D>();
  private readonly ctx: LocationContext;
  private time = 0;

  constructor(
    private readonly locations: Record<string, LocationDef>,
    readonly audio: AudioEngine,
    overlay: HTMLElement,
    aspect: number,
  ) {
    this.rig = new CameraRig(aspect);
    // Soft fill that travels with the camera keeps faces readable in dark rooms.
    const fill = new THREE.PointLight("#ffe2c4", 0.45, 6, 1.5);
    fill.position.set(0.4, 0.3, 0);
    this.rig.camera.add(fill);
    this.scene.add(this.rig.camera);
    this.particles.addTo(this.scene);
    this.fxs = new FxSystem(this.scene, this.particles, this.timeline, this.rig, audio, overlay);
    this.ctx = {
      particles: this.particles,
      audio,
      timeline: this.timeline,
      actor: (id) => this.actors.get(id),
    };
  }

  // Image-based lighting for metal and glossy surfaces; needs the GL context.
  setupEnvironment(gl: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  // ---- Stage port ------------------------------------------------------

  async loadLocation(id: string): Promise<void> {
    const def = this.locations[id];
    if (!def) throw new Error(`unknown location ${id}`);
    const covered = this.locationId !== null;
    const loading = def.preload?.();
    if (covered) await this.fxs.fade("#000000", 1, 450);
    await loading;
    if (this.location) {
      this.location.dispose?.();
      this.scene.remove(this.location.root);
      disposeTree(this.location.root);
    }
    this.particles.clear();
    const loc = def.build(this.ctx);
    for (const m of def.info.marks) {
      if (!loc.marks[m]) throw new Error(`location ${id} declares mark "${m}" but does not build it`);
    }
    this.location = loc;
    this.locationId = id;
    this.scene.add(loc.root);
    this.scene.background = loc.background;
    this.scene.fog = loc.fog;
    this.scene.environmentIntensity = loc.environmentIntensity ?? 0.25;
    this.rig.bounds = loc.bounds;
    // Props and architecture that cast shadows are solid enough to block a shot.
    const occluders: THREE.Object3D[] = [];
    loc.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.castShadow && o.frustumCulled) occluders.push(o);
    });
    this.rig.occluders = occluders;
    this.rig.cut(loc.wide.pos, loc.wide.look);
    if (loc.music) this.audio.music(loc.music);
    if (covered) void this.fxs.fade(null, 0, 700);
    else this.fxs.clearOverlay();
  }

  // Builds a location with no cast and lets the camera drift through it.
  async showcase(id: string): Promise<void> {
    await this.loadLocation(id);
    const loc = this.mustLocation();
    this.rig.drift(loc.wide.look, loc.wide.pos);
  }

  currentLocation(): string | null {
    return this.locationId;
  }

  hasActor(id: string): boolean {
    return this.actors.has(id);
  }

  placeActor(id: string, spec: ActorSpec, at: Target): void {
    this.removeActor(id);
    const a = createActor(id, spec);
    a.place(this.floorPoint(at));
    // Face the room's camera side by default so entrances read well.
    a.face(this.location?.wide.pos ?? new THREE.Vector3(0, 0, 10), true);
    this.actors.set(id, a);
    this.scene.add(a.root);
  }

  removeActor(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.dispose();
    this.actors.delete(id);
  }

  clearActors(): void {
    for (const id of [...this.actors.keys()]) this.removeActor(id);
  }

  moveActor(id: string, to: Target, run: boolean, instant: boolean): Promise<void> {
    const a = this.need(id);
    const dest = this.floorPoint(to);
    // Moving to another actor stops at arm's length instead of walking into them.
    const other = typeof to === "string" && to !== id ? this.actors.get(to) : undefined;
    if (other) {
      const back = a.position.clone().sub(other.position).setY(0);
      if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
      dest.copy(other.position).addScaledVector(back.normalize(), 0.7 + other.height * 0.2).setY(0);
    }
    return a.moveTo(dest, run, instant);
  }

  lookAt(id: string, at: Target, instant: boolean): void {
    const a = this.need(id);
    this.explicitLook.add(id);
    const p = this.focusPoint(at);
    a.lookAt(p);
    a.face(p, instant);
  }

  playAnim(id: string, clip: AnimClip, hold: boolean, instant: boolean): Promise<void> {
    return this.need(id).play(clip, hold, instant);
  }

  perform(id: string, use: string, hold: boolean, instant: boolean): Promise<void> {
    const a = this.need(id);
    return a instanceof ClipActor ? a.perform(use, hold, instant) : Promise.resolve();
  }

  useProps(models: Record<string, PropModel>): void {
    for (const p of this.props.values()) p.removeFromParent();
    this.props.clear();
    this.propModels = models;
  }

  takeProp(prop: string, actor: string): void {
    this.need(actor).socket("hand_r").add(this.prop(prop));
  }

  async giveProp(prop: string, from: string, to: string, instant: boolean): Promise<void> {
    const p = this.prop(prop);
    const hand = this.need(to).socket("hand_r");
    if (!p.parent) this.need(from).socket("hand_r").add(p);
    if (!instant) {
      // Lift the prop out of the giver's hand and carry it across in world space.
      const start = p.getWorldPosition(new THREE.Vector3());
      this.scene.attach(p);
      const end = new THREE.Vector3();
      await this.timeline.tween(600, (u) => {
        hand.getWorldPosition(end);
        p.position.lerpVectors(start, end, u * u * (3 - 2 * u));
      });
    }
    hand.attach(p);
    p.position.set(0, 0, 0);
  }

  putProp(prop: string, at: Target): void {
    const p = this.prop(prop);
    this.scene.attach(p);
    p.position.copy(this.floorPoint(at));
    p.rotation.set(0, 0, 0);
  }

  // A generated prop, scaled so its longest side matches its size; the
  // model drops in when its file has loaded.
  private prop(id: string): THREE.Object3D {
    let p = this.props.get(id);
    if (p) return p;
    const model = this.propModels[id];
    if (!model) throw new Error(`unknown prop ${id}`);
    p = new THREE.Group();
    p.name = `prop:${id}`;
    p.userData.shared = true;
    this.props.set(id, p);
    const holder = p;
    if (model.parts) {
      p.add(buildParts({ parts: model.parts }));
      return p;
    }
    void loadGltf(model.url!).then((g) => {
      const body = g.scene.clone(true);
      const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
      body.scale.setScalar(model.size / Math.max(0.001, size.x, size.y, size.z));
      body.traverse((o) => (o.castShadow = true));
      holder.add(body);
    });
    return p;
  }

  setSpeaking(id: string, speaking: boolean): void {
    const a = this.need(id);
    a.speaking = speaking;
    if (!speaking) return;
    // Conversation blocking: listeners turn to the speaker; the speaker
    // addresses the nearest listener unless the story aimed them elsewhere.
    const head = a.headPosition(new THREE.Vector3());
    let nearest: Actor | null = null;
    let best = Infinity;
    for (const [oid, o] of this.actors) {
      if (oid === id) continue;
      const d = o.position.distanceTo(a.position);
      if (d < best && o.spec.kind === "human") {
        best = d;
        nearest = o;
      }
      if (!this.explicitLook.has(oid) && o.spec.kind === "human" && d < 8) o.lookAt(head);
    }
    if (!this.explicitLook.has(id) && nearest) a.lookAt(nearest.headPosition(new THREE.Vector3()));
  }

  async camera(shot: CameraShot, on: Target | undefined, withTarget: Target | undefined, ms: number): Promise<void> {
    const loc = this.mustLocation();
    const subject = on !== undefined ? this.subject(on) : undefined;
    const other = withTarget !== undefined ? this.subject(withTarget) : undefined;
    await this.rig.frame({ shot, subject, other, wide: loc.wide }, ms);
    const followable = shot === "close" || shot === "medium" || shot === "low" || shot === "high";
    if (followable && typeof on === "string" && this.actors.has(on)) {
      const actor = this.actors.get(on)!;
      const live: ShotSubject = { point: new THREE.Vector3() };
      Object.defineProperty(live, "point", { get: () => actor.headPosition(new THREE.Vector3()) });
      this.rig.follow(live);
    }
  }

  fx(kind: FxKind, o: FxOptions): Promise<void> {
    return this.fxs.run(kind, {
      from: o.from !== undefined ? this.castPoint(o.from) : undefined,
      to: o.to !== undefined ? this.hitPoint(o.to) : undefined,
      at: o.at !== undefined ? this.hitPoint(o.at) : undefined,
      color: o.color ?? "#ffd27a",
      ms: o.ms,
    });
  }

  setProp(prop: string, state: string): void {
    this.mustLocation().setProp(prop, state, false);
  }

  sfx(name: string): void {
    this.audio.sfx(name);
  }

  music(name: string): void {
    this.audio.music(name);
  }

  resetLook(): void {
    this.explicitLook.clear();
    for (const a of this.actors.values()) a.lookAt(null);
  }

  // ---- frame -------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.timeline.update(dt);
    this.location?.update(dt, this.time);
    for (const a of this.actors.values()) a.update(dt);
    this.fxs.update(dt);
    this.particles.update(dt);
    this.rig.update(dt);
  }

  // ---- target resolution ---------------------------------------------------

  private need(id: string): Actor {
    const a = this.actors.get(id);
    if (!a) throw new Error(`actor ${id} is not on stage`);
    return a;
  }

  private mustLocation(): LocationInstance {
    if (!this.location) throw new Error("no location loaded");
    return this.location;
  }

  private mark(name: string): THREE.Vector3 | undefined {
    return this.location?.marks[name];
  }

  floorPoint(t: Target): THREE.Vector3 {
    if (Array.isArray(t)) return new THREE.Vector3(t[0], 0, t[1]);
    const m = this.mark(t);
    if (m) return m.clone();
    const a = this.actors.get(t);
    if (a) return a.position.clone();
    throw new Error(`cannot resolve target "${t}"`);
  }

  focusPoint(t: Target): THREE.Vector3 {
    if (typeof t === "string") {
      const a = this.actors.get(t);
      if (a) return a.headPosition(new THREE.Vector3());
      if (t === "camera") return this.rig.camera.position.clone();
    }
    const p = this.floorPoint(t);
    if (p.y < 0.05) p.y += FOCUS_LIFT;
    return p;
  }

  private castPoint(t: Target): THREE.Vector3 {
    const a = typeof t === "string" ? this.actors.get(t) : undefined;
    return a ? a.castPoint(new THREE.Vector3()) : this.focusPoint(t);
  }

  private hitPoint(t: Target): THREE.Vector3 {
    const a = typeof t === "string" ? this.actors.get(t) : undefined;
    if (a) return a.headPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -a.height * 0.18, 0));
    return this.floorPoint(t);
  }

  private subject(t: Target): ShotSubject {
    const a = typeof t === "string" ? this.actors.get(t) : undefined;
    if (a) return { point: a.headPosition(new THREE.Vector3()), yaw: a.facing, height: a.height };
    // Places get wider framing than faces.
    return { point: this.focusPoint(t), height: 2.6 };
  }

  actor(id: string): Actor | undefined {
    return this.actors.get(id);
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    // Generated models share geometry with a cache; they are not freed here.
    if (o.userData.shared) return;
    if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    }
  });
}
