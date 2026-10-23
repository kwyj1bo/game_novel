import * as THREE from "three";
import type { ActorSpec, AnimClip } from "../story/schema";
import { clamp, damp, easeInCubic, envelope, lerp, noise1 } from "../core/math";
import { Actor } from "./Actor";

export type BeastKind = "dog" | "cat" | "owl" | "dragon" | "centaur" | "unicorn";

const CLIP_SECONDS: Partial<Record<AnimClip, number>> = { roar: 1.6, lunge: 1.0, fall: 1.4, nod: 0.9, shake: 1.0, sleep: 1.6, cower: 1.2, jump: 0.9 };

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function joint(parent: THREE.Object3D, pos: [number, number, number]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

// One procedural rig for ordinary animals and magical creatures. A variant
// sets proportions and extras (wings, horn, a rider's torso for a centaur).
// Sizes are relative to spec.height (height at the head).
export class Beast extends Actor {
  private readonly k: number;
  private readonly body = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group; front: boolean }[] = [];
  private readonly neck: THREE.Group;
  private readonly head: THREE.Group;
  private readonly jaw: THREE.Group | null = null;
  private readonly tail: THREE.Group;
  private readonly wings: THREE.Group[] = [];
  private readonly torso: THREE.Group | null = null;
  private lower = 0;
  private jawOpen = 0;
  private lunge = 0;
  private pitch = 0;

  constructor(
    id: string,
    spec: ActorSpec,
    readonly variant: BeastKind,
  ) {
    super(id, spec);
    // Body parts are laid out in units where the head sits at UNIT_HEIGHT;
    // scale so the head ends up at spec.height.
    const UNIT_HEIGHT: Record<BeastKind, number> = { owl: 0.98, dog: 1.0, cat: 0.83, unicorn: 1.3, dragon: 1.13, centaur: 2.1 };
    const k = (this.k = spec.height / UNIT_HEIGHT[variant]);
    const furColor = new THREE.Color(spec.robe);
    const fur = new THREE.MeshStandardMaterial({ color: furColor, roughness: variant === "dragon" ? 0.55 : 0.95, metalness: variant === "dragon" ? 0.1 : 0 });
    const dark = new THREE.MeshStandardMaterial({ color: furColor.clone().multiplyScalar(0.6), roughness: 1 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: spec.eyes, emissive: new THREE.Color(spec.eyes).multiplyScalar(variant === "dragon" ? 0.8 : 0.15), roughness: 0.3 });
    this.root.add(this.body);

    if (variant === "owl") {
      // Upright bird: egg body, round head, big eyes, folded wings.
      add(this.body, new THREE.SphereGeometry(0.22 * k, 16, 12), fur, [0, 0.42 * k, 0], undefined, [1, 1.35, 0.95]);
      this.neck = joint(this.body, [0, 0.72 * k, 0]);
      this.head = joint(this.neck, [0, 0.08 * k, 0]);
      add(this.head, new THREE.SphereGeometry(0.18 * k, 16, 12), fur, [0, 0, 0]);
      for (const s of [1, -1]) {
        add(this.head, new THREE.SphereGeometry(0.06 * k, 10, 8), eyeMat, [s * 0.07 * k, 0.02 * k, 0.14 * k]);
        add(this.head, new THREE.SphereGeometry(0.028 * k, 8, 6), new THREE.MeshStandardMaterial({ color: "#111" }), [s * 0.07 * k, 0.02 * k, 0.19 * k]);
        const w = joint(this.body, [s * 0.2 * k, 0.55 * k, 0]);
        add(w, new THREE.SphereGeometry(0.16 * k, 12, 8), dark, [s * 0.05 * k, -0.08 * k, 0], undefined, [0.35, 1.2, 0.9]);
        this.wings.push(w);
      }
      add(this.head, new THREE.ConeGeometry(0.03 * k, 0.07 * k, 6), new THREE.MeshStandardMaterial({ color: "#3a3020" }), [0, -0.04 * k, 0.18 * k], [Math.PI / 2, 0, 0]);
      for (const s of [1, -1]) add(this.body, new THREE.CylinderGeometry(0.015 * k, 0.015 * k, 0.12 * k, 6), new THREE.MeshStandardMaterial({ color: "#5a4a2a" }), [s * 0.07 * k, 0.1 * k, 0]);
      this.tail = joint(this.body, [0, 0.2 * k, -0.15 * k]);
      return;
    }

    // Quadrupeds. Proportions per variant: body length, leg length, neck rise.
    const P = {
      dog: { len: 0.9, girth: 0.28, leg: 0.5, neck: 0.25, snout: 0.22, ear: 0.12 },
      cat: { len: 0.7, girth: 0.2, leg: 0.42, neck: 0.18, snout: 0.08, ear: 0.1 },
      unicorn: { len: 0.95, girth: 0.26, leg: 0.6, neck: 0.42, snout: 0.38, ear: 0.08 },
      centaur: { len: 0.95, girth: 0.26, leg: 0.6, neck: 0.0, snout: 0, ear: 0 },
      dragon: { len: 1.1, girth: 0.3, leg: 0.4, neck: 0.45, snout: 0.32, ear: 0.0 },
    }[variant];
    const legH = P.leg * k;
    const bodyY = legH + P.girth * k * 0.5;
    add(this.body, new THREE.CapsuleGeometry(P.girth * k, P.len * k, 8, 16), fur, [0, bodyY, 0], [Math.PI / 2, 0, 0]);
    for (const [x, z, front] of [
      [0.6, 0.42, true],
      [-0.6, 0.42, true],
      [0.6, -0.42, false],
      [-0.6, -0.42, false],
    ] as const) {
      const hip = joint(this.body, [x * P.girth * k, legH, z * P.len * k]);
      add(hip, new THREE.CapsuleGeometry(0.08 * k * (P.girth / 0.26), legH * 0.4, 4, 8), fur, [0, -legH * 0.27, 0]);
      const knee = joint(hip, [0, -legH * 0.52, 0]);
      add(knee, new THREE.CapsuleGeometry(0.06 * k * (P.girth / 0.26), legH * 0.38, 4, 8), fur, [0, -legH * 0.24, 0]);
      add(knee, new THREE.SphereGeometry(0.07 * k * (P.girth / 0.26), 8, 6), dark, [0, -legH * 0.48, 0.02 * k], undefined, [1, 0.5, 1.3]);
      this.legs.push({ hip, knee, front });
    }
    this.tail = joint(this.body, [0, bodyY + 0.05 * k, -(P.len / 2 + P.girth) * k]);
    add(this.tail, new THREE.CapsuleGeometry(0.03 * k, (variant === "dragon" ? 0.9 : 0.4) * k, 4, 8), variant === "unicorn" || variant === "centaur" ? dark : fur, [0, 0, -0.25 * k], [-1.0, 0, 0]);

    if (variant === "centaur") {
      // A man's torso rises where a horse's neck would be.
      const skin = new THREE.MeshStandardMaterial({ color: spec.skin, roughness: 0.6 });
      const hair = new THREE.MeshStandardMaterial({ color: spec.hair, roughness: 0.8 });
      this.torso = joint(this.body, [0, bodyY + 0.12 * k, (P.len / 2 + 0.05) * k]);
      add(this.torso, new THREE.CylinderGeometry(0.16 * k, 0.2 * k, 0.5 * k, 12), skin, [0, 0.25 * k, 0]);
      for (const s of [1, -1]) {
        const arm = joint(this.torso, [s * 0.2 * k, 0.45 * k, 0]);
        add(arm, new THREE.CapsuleGeometry(0.05 * k, 0.4 * k, 4, 8), skin, [0, -0.22 * k, 0.04 * k], [0.2, 0, s * 0.15]);
      }
      this.neck = joint(this.torso, [0, 0.52 * k, 0]);
      this.head = joint(this.neck, [0, 0.13 * k, 0]);
      add(this.head, new THREE.SphereGeometry(0.12 * k, 16, 12), skin, [0, 0, 0]);
      add(this.head, new THREE.SphereGeometry(0.13 * k, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, [0, 0.02 * k, -0.01 * k], [-0.3, 0, 0]);
      add(this.head, new THREE.BoxGeometry(0.22 * k, 0.3 * k, 0.06 * k), hair, [0, -0.1 * k, -0.1 * k]);
      for (const s of [1, -1]) add(this.head, new THREE.SphereGeometry(0.018 * k, 8, 6), eyeMat, [s * 0.045 * k, 0.02 * k, 0.11 * k]);
      return;
    }

    this.neck = joint(this.body, [0, bodyY + 0.05 * k, (P.len / 2 + P.girth * 0.6) * k]);
    add(this.neck, new THREE.CapsuleGeometry(P.girth * 0.55 * k, P.neck * k, 4, 10), fur, [0, P.neck * 0.5 * k, 0.05 * k], [0.5, 0, 0]);
    this.head = joint(this.neck, [0, (P.neck + 0.08) * k, 0.12 * k]);
    const headR = (variant === "cat" ? 0.13 : 0.15) * k;
    add(this.head, new THREE.SphereGeometry(headR, 14, 10), fur, [0, 0, 0]);
    if (P.snout) add(this.head, new THREE.CylinderGeometry(headR * 0.45, headR * 0.7, P.snout * k, 10), fur, [0, -headR * 0.15, headR + P.snout * 0.4 * k], [Math.PI / 2, 0, 0], [1, 1, 0.8]);
    // Dogs, cats and dragons get a dark nose; a horse's muzzle is plain.
    if (variant !== "unicorn") add(this.head, new THREE.SphereGeometry(headR * 0.2, 8, 6), new THREE.MeshStandardMaterial({ color: "#151210" }), [0, -headR * 0.05, headR + P.snout * 0.9 * k]);
    for (const s of [1, -1]) {
      add(this.head, new THREE.SphereGeometry(headR * 0.16, 8, 6), eyeMat, [s * headR * 0.5, headR * 0.3, headR * 0.75]);
      if (P.ear) add(this.head, new THREE.ConeGeometry(headR * 0.3, P.ear * k, 5), dark, [s * headR * 0.55, headR * 0.85, -headR * 0.1], [variant === "dog" ? 0.4 : -0.1, 0, -s * 0.3]);
    }
    if (variant === "dog" || variant === "dragon") {
      this.jaw = joint(this.head, [0, -headR * 0.45, headR * 0.6]);
      add(this.jaw, new THREE.BoxGeometry(headR * 0.8, headR * 0.2, P.snout * k), fur, [0, 0, P.snout * 0.45 * k]);
    }
    if (variant === "unicorn") {
      add(this.head, new THREE.ConeGeometry(0.03 * k, 0.32 * k, 10), new THREE.MeshStandardMaterial({ color: "#f8f2e0", emissive: new THREE.Color("#fff6d0"), emissiveIntensity: 0.6 }), [0, headR * 1.2, headR * 0.4], [0.5, 0, 0]);
      add(this.neck, new THREE.BoxGeometry(0.04 * k, P.neck * k, 0.1 * k), new THREE.MeshStandardMaterial({ color: "#f4f0ff" }), [0, P.neck * 0.5 * k, -0.08 * k], [0.5, 0, 0]);
    }
    if (variant === "dragon") {
      for (let i = 0; i < 7; i++) add(this.body, new THREE.ConeGeometry(0.05 * k, 0.16 * k, 5), dark, [0, bodyY + P.girth * k, (0.5 - i * 0.16) * P.len * k]);
      for (const s of [1, -1]) {
        const w = joint(this.body, [s * P.girth * k, bodyY + 0.15 * k, 0.15 * k]);
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(0.9 * k, 0.35 * k);
        shape.lineTo(0.75 * k, -0.15 * k);
        shape.lineTo(0.45 * k, -0.05 * k);
        shape.lineTo(0.2 * k, -0.25 * k);
        shape.lineTo(0, 0);
        const wm = add(w, new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: furColor.clone().multiplyScalar(0.75), side: THREE.DoubleSide, roughness: 0.7 }), [0, 0, 0], [-Math.PI / 2, 0, 0]);
        wm.scale.x = s;
        this.wings.push(w);
      }
    }
  }

  get height(): number {
    return this.spec.height;
  }

  protected clipDuration(clip: AnimClip): number {
    return CLIP_SECONDS[clip] ?? 1.0;
  }

  protected walkSpeed(): number {
    return this.variant === "owl" ? 2.5 : this.variant === "cat" ? 1.2 : 1.6 * Math.max(0.6, this.k);
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return this.head.getWorldPosition(out);
  }

  castPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.headPosition(out);
  }

  protected pose(dt: number): void {
    const t = this.time;
    const c = this.clipState();
    let lower = 0;
    let jaw = 0;
    let lunge = 0;
    let pitch = 0;
    let shake = 0;
    if (c) {
      const w = envelope(c.u, 0.2, 0.2, c.hold);
      if (c.name === "sleep" || c.name === "fall") lower = c.hold ? easeInCubic(clamp(c.u * 1.2, 0, 1)) : w;
      if (c.name === "roar") (jaw = 0.8 * w), (pitch = -0.4 * w);
      if (c.name === "lunge") (lunge = w), (jaw = 0.7 * w);
      if (c.name === "nod") pitch = Math.sin(c.u * Math.PI * 3) * 0.3 * w;
      if (c.name === "shake") shake = w;
      if (c.name === "cower") lower = 0.4 * w;
      if (c.name === "jump") this.body.position.y = Math.sin(c.u * Math.PI) * 0.3 * this.k;
    }
    this.lower = damp(this.lower, lower, 6, dt);
    this.jawOpen = damp(this.jawOpen, jaw, 12, dt);
    this.lunge = damp(this.lunge, lunge, 10, dt);
    this.pitch = damp(this.pitch, pitch, 10, dt);
    const speed = clamp(this.speed / this.walkSpeed(), 0, 1);
    const phase = (this.gait / (0.5 * Math.max(0.4, this.k))) * Math.PI;

    if (this.variant === "owl") {
      const airborne = this.root.position.y > 0.2 || speed > 0.1;
      for (const [i, w] of this.wings.entries()) w.rotation.z = (i ? -1 : 1) * (airborne ? 0.6 + Math.sin(t * 22) * 0.9 : 0.05);
      this.body.rotation.x = airborne ? 0.4 : this.lower * 0.6;
    } else {
      this.body.position.y = -this.lower * this.k * 0.3 + Math.sin(t * 1.8) * 0.01 * this.k;
      this.body.position.z = this.lunge * 0.4 * this.k;
      this.body.rotation.z = this.lower > 0.5 && this.variant !== "centaur" ? this.lower * 1.2 : 0;
      for (const [i, leg] of this.legs.entries()) {
        const s = Math.sin(phase + (i % 2 ? Math.PI : 0) + (leg.front ? 0 : Math.PI / 2));
        leg.hip.rotation.x = s * 0.5 * speed + (leg.front ? -0.4 : 0.3) * this.lunge;
        leg.knee.rotation.x = Math.max(0, s) * 0.6 * speed;
      }
      for (const [i, w] of this.wings.entries()) w.rotation.z = (i ? -1 : 1) * (0.2 + Math.sin(t * (speed > 0.5 ? 10 : 1.5)) * (speed > 0.5 ? 0.6 : 0.08));
    }
    this.head.rotation.x = this.pitch + noise1(t * 0.5, this.k) * 0.08;
    this.head.rotation.y = noise1(t * 0.4, 3) * 0.35 + Math.sin(t * 30) * 0.15 * shake;
    if (this.jaw) this.jaw.rotation.x = this.jawOpen;
    this.tail.rotation.y = Math.sin(t * (this.variant === "dog" ? 6 : 2)) * 0.3;
    if (this.torso) this.torso.rotation.x = lerp(0, 0.3, this.lunge) + noise1(t * 0.3, 7) * 0.04;
  }
}
