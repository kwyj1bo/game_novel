import * as THREE from "three";
import type { ActorSpec, AnimClip } from "../story/schema";
import { clamp, damp, easeInCubic, envelope, lerp, noise1, rng, smoothstep } from "../core/math";
import { Actor } from "./Actor";

interface Head {
  neck: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group;
  eyes: THREE.Mesh[];
  phase: number;
}

const CLIP_SECONDS: Partial<Record<AnimClip, number>> = {
  sleep: 2.2,
  wake: 1.4,
  lunge: 0.9,
  roar: 2.0,
  shake: 1.2,
  nod: 1.0,
};

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// A giant three-headed dog. Starts awake; "sleep" (held) lies it down.
export class Dog3 extends Actor {
  private readonly k: number;
  private readonly body = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group; front: boolean }[] = [];
  private readonly heads: Head[] = [];
  private readonly tail = new THREE.Group();
  private lower = 0;
  private jawOpen = 0.15;
  private lungeAmt = 0;
  private eyeOpen = 1;

  constructor(id: string, spec: ActorSpec) {
    super(id, spec);
    const k = (this.k = spec.height / 3.4);
    const fur = new THREE.MeshStandardMaterial({ color: spec.robe, roughness: 1 });
    const furDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.robe).multiplyScalar(0.6), roughness: 1 });
    const black = new THREE.MeshStandardMaterial({ color: "#0b0908", roughness: 0.4 });
    const tooth = new THREE.MeshStandardMaterial({ color: "#efe6cf", roughness: 0.4 });
    const gum = new THREE.MeshStandardMaterial({ color: "#5a1a1e", roughness: 0.6 });
    const eye = new THREE.MeshStandardMaterial({ color: "#ffcc33", emissive: new THREE.Color("#ffaa00"), emissiveIntensity: 1.6 });

    this.root.add(this.body);
    // Torso: a long capsule with a deep chest.
    add(this.body, new THREE.CapsuleGeometry(0.85 * k, 1.9 * k, 8, 20), fur, [0, 2.0 * k, -0.1 * k], [Math.PI / 2, 0, 0], [1, 1, 0.92]);
    add(this.body, new THREE.SphereGeometry(1.05 * k, 20, 14), fur, [0, 2.15 * k, 0.9 * k], undefined, [1, 1.05, 1]);
    // Muscular haunches and shoulders so the body isn't a plain tube.
    for (const s of [1, -1]) {
      add(this.body, new THREE.SphereGeometry(0.62 * k, 16, 12), fur, [s * 0.42 * k, 2.0 * k, -1.15 * k], undefined, [0.8, 1.05, 1.1]);
      add(this.body, new THREE.SphereGeometry(0.6 * k, 16, 12), fur, [s * 0.45 * k, 2.15 * k, 1.0 * k], undefined, [0.8, 1.1, 1]);
    }
    // Shaggy fur: clumps over the flanks, chest and belly.
    const rand = rng(99);
    for (let i = 0; i < 70; i++) {
      const z = lerp(-1.9, 1.6, rand()) * k;
      const a = lerp(-2.3, 2.3, rand());
      const pos = new THREE.Vector3(Math.sin(a) * 0.86 * k, 2.0 * k + Math.cos(a) * 0.82 * k, z);
      const m = add(this.body, new THREE.ConeGeometry(0.13 * k, 0.42 * k, 5), rand() < 0.5 ? fur : furDark, [pos.x, pos.y, pos.z]);
      const out = new THREE.Vector3(Math.sin(a), Math.cos(a), 0).add(new THREE.Vector3(0, -0.6, -0.4)).normalize();
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
    }
    // Scruffy fur clumps along the spine.
    for (let i = 0; i < 9; i++) {
      add(this.body, new THREE.ConeGeometry(0.22 * k, 0.5 * k, 5), furDark, [Math.sin(i * 2.1) * 0.2 * k, 2.85 * k - Math.abs(i - 3) * 0.04 * k, 1.1 * k - i * 0.3 * k], [-0.5, 0, Math.sin(i) * 0.4]);
    }

    for (const [x, z, front] of [
      [0.6, 1.0, true],
      [-0.6, 1.0, true],
      [0.62, -1.1, false],
      [-0.62, -1.1, false],
    ] as const) {
      const hip = new THREE.Group();
      hip.position.set(x * k, 1.9 * k, z * k);
      this.body.add(hip);
      add(hip, new THREE.CapsuleGeometry(0.3 * k, 0.7 * k, 6, 12), fur, [0, -0.5 * k, 0]);
      const knee = new THREE.Group();
      knee.position.set(0, -1.0 * k, 0);
      hip.add(knee);
      add(knee, new THREE.CapsuleGeometry(0.2 * k, 0.6 * k, 6, 12), fur, [0, -0.45 * k, 0]);
      add(knee, new THREE.SphereGeometry(0.3 * k, 12, 8), furDark, [0, -0.9 * k, 0.12 * k], undefined, [1, 0.55, 1.3]);
      for (const c of [-1, 0, 1]) add(knee, new THREE.ConeGeometry(0.04 * k, 0.16 * k, 5), black, [c * 0.12 * k, -0.95 * k, 0.45 * k], [Math.PI / 2, 0, 0]);
      this.legs.push({ hip, knee, front });
    }

    for (const [i, x] of [-0.8, 0, 0.8].entries()) {
      const neck = new THREE.Group();
      neck.position.set(x * k, 2.7 * k, 1.5 * k);
      neck.rotation.y = -x * 0.35;
      this.body.add(neck);
      add(neck, new THREE.CapsuleGeometry(0.42 * k, 0.8 * k, 6, 14), fur, [0, 0.35 * k, 0.35 * k], [0.75, 0, 0]);
      // Spiked leather collar.
      const leather = new THREE.MeshStandardMaterial({ color: "#3a1c12", roughness: 0.6 });
      const steel = new THREE.MeshStandardMaterial({ color: "#9a9a9a", metalness: 0.9, roughness: 0.3 });
      const collar = new THREE.Group();
      collar.position.set(0, 0.2 * k, 0.2 * k);
      collar.rotation.x = 0.75 + Math.PI / 2;
      neck.add(collar);
      add(collar, new THREE.TorusGeometry(0.45 * k, 0.07 * k, 8, 24), leather, [0, 0, 0]);
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * Math.PI * 2;
        const spike = add(collar, new THREE.ConeGeometry(0.05 * k, 0.16 * k, 6), steel, [Math.cos(a) * 0.52 * k, Math.sin(a) * 0.52 * k, 0]);
        spike.rotation.z = a - Math.PI / 2;
      }
      const head = new THREE.Group();
      head.position.set(0, 0.85 * k, 0.75 * k);
      neck.add(head);
      add(head, new THREE.SphereGeometry(0.55 * k, 18, 14), fur, [0, 0, 0], undefined, [1, 0.92, 1.05]);
      // Upper snout + nose.
      add(head, new THREE.CylinderGeometry(0.17 * k, 0.3 * k, 0.8 * k, 10), fur, [0, -0.06 * k, 0.62 * k], [Math.PI / 2, 0, 0], [1, 1, 0.75]);
      add(head, new THREE.SphereGeometry(0.085 * k, 10, 8), black, [0, 0.02 * k, 1.02 * k], undefined, [1.4, 0.9, 0.8]);
      // Brow ridge gives the heads a scowl.
      add(head, new THREE.BoxGeometry(0.6 * k, 0.1 * k, 0.2 * k), furDark, [0, 0.25 * k, 0.4 * k], [0.35, 0, 0]);
      for (const s of [1, -1]) {
        add(head, new THREE.ConeGeometry(0.035 * k, 0.16 * k, 5), tooth, [s * 0.2 * k, -0.27 * k, 0.88 * k], [Math.PI, 0, 0]);
        add(head, new THREE.ConeGeometry(0.03 * k, 0.11 * k, 5), tooth, [s * 0.1 * k, -0.25 * k, 0.95 * k], [Math.PI, 0, 0]);
        add(head, new THREE.ConeGeometry(0.2 * k, 0.5 * k, 6), furDark, [s * 0.35 * k, 0.5 * k, -0.1 * k], [-0.3, 0, -s * 0.45]);
      }
      const eyes = [1, -1].map((s) => add(head, new THREE.SphereGeometry(0.08 * k, 10, 8), eye, [s * 0.24 * k, 0.16 * k, 0.42 * k]));
      const jaw = new THREE.Group();
      jaw.position.set(0, -0.2 * k, 0.25 * k);
      head.add(jaw);
      add(jaw, new THREE.BoxGeometry(0.5 * k, 0.15 * k, 0.7 * k), fur, [0, -0.06 * k, 0.38 * k]);
      add(jaw, new THREE.BoxGeometry(0.42 * k, 0.04 * k, 0.6 * k), gum, [0, 0.03 * k, 0.38 * k]);
      for (const s of [1, -1]) add(jaw, new THREE.ConeGeometry(0.035 * k, 0.14 * k, 5), tooth, [s * 0.18 * k, 0.1 * k, 0.62 * k]);
      this.heads.push({ neck, head, jaw, eyes, phase: i * 2.3 });
    }

    this.tail.position.set(0, 2.4 * k, -1.9 * k);
    this.body.add(this.tail);
    add(this.tail, new THREE.CapsuleGeometry(0.14 * k, 1.1 * k, 4, 8), fur, [0, 0.4 * k, -0.4 * k], [-0.8, 0, 0]);
  }

  get height(): number {
    return this.spec.height;
  }

  protected clipDuration(clip: AnimClip): number {
    return CLIP_SECONDS[clip] ?? 1.2;
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.heads[1].head.updateWorldMatrix(true, false);
    return this.heads[1].head.getWorldPosition(out);
  }

  castPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.headPosition(out);
  }

  protected walkSpeed(): number {
    return 2.2;
  }

  protected pose(dt: number): void {
    const t = this.time;
    const k = this.k;
    const c = this.clipState();
    let lower = 0;
    let jaw = 0.12 + Math.max(0, Math.sin(t * 3)) * 0.12;
    let headPitch = 0;
    let shakeAmt = 0;
    let lunge = 0;
    let eyes = 1;

    if (c) {
      const w = envelope(c.u, 0.2, 0.2, c.hold);
      switch (c.name) {
        case "sleep":
          lower = c.hold ? smoothstep(c.u) : w;
          eyes = 1 - lower;
          jaw = lerp(jaw, 0.02, lower);
          break;
        case "wake": {
          lower = 1 - smoothstep(c.u / 0.6);
          eyes = smoothstep(c.u / 0.2);
          headPitch = -0.3 * Math.sin(clamp(c.u, 0, 1) * Math.PI);
          jaw = lerp(jaw, 0.6, Math.sin(c.u * Math.PI));
          break;
        }
        case "roar":
          headPitch = -0.45 * w;
          jaw = lerp(jaw, 0.85 + Math.sin(t * 30) * 0.05, w);
          shakeAmt = w;
          break;
        case "lunge": {
          const crouch = c.u < 0.35 ? smoothstep(c.u / 0.35) : 1 - smoothstep((c.u - 0.35) / 0.2);
          const spring = c.hold ? smoothstep((c.u - 0.35) / 0.3) : envelope(c.u, 0.35, 0.3) * (c.u > 0.35 ? 1 : 0);
          lower = 0.25 * crouch;
          lunge = spring;
          headPitch = 0.25 * spring;
          jaw = lerp(jaw, 0.9, spring);
          break;
        }
        case "shake":
          shakeAmt = w;
          break;
        case "nod":
          headPitch = Math.sin(c.u * Math.PI * 3) * 0.25 * w;
          break;
        default:
          break;
      }
    } else if (this.speaking) {
      jaw = 0.3 + Math.max(0, noise1(t * 8)) * 0.4;
    }

    // Walking: simple trot on the legs.
    const sp = this.speed;
    const phase = (this.gait / (1.6 * k)) * Math.PI;
    const amp = clamp(sp / 2, 0, 1) * 0.5;

    this.lower = damp(this.lower, lower, 6, dt);
    this.jawOpen = damp(this.jawOpen, jaw, 14, dt);
    this.lungeAmt = damp(this.lungeAmt, lunge, 10, dt);
    this.eyeOpen = damp(this.eyeOpen, eyes, 8, dt);

    const breathe = Math.sin(t * (this.lower > 0.5 ? 0.9 : 1.8)) * 0.03 * k;
    this.body.position.y = -this.lower * 1.15 * k + breathe;
    this.body.position.z = this.lungeAmt * 1.6 * k;
    this.body.rotation.x = this.lungeAmt * 0.12 - this.lower * 0.04;

    for (const [i, leg] of this.legs.entries()) {
      const s = Math.sin(phase + (i % 2 ? Math.PI : 0) + (leg.front ? 0 : Math.PI / 2));
      const fold = this.lower;
      // Lying down: front legs stretch forward, hind legs tuck under.
      leg.hip.rotation.x = (leg.front ? -1.17 : -1.3) * fold + s * amp + (leg.front ? -0.5 : 0.3) * this.lungeAmt;
      leg.knee.rotation.x = (leg.front ? 0 : 2.3) * fold + Math.max(0, s) * amp;
    }

    for (const h of this.heads) {
      const sway = 1 - this.lower * 0.8;
      h.head.rotation.y = noise1(t * 0.6, h.phase) * 0.45 * sway + Math.sin(t * 40 + h.phase) * 0.08 * shakeAmt;
      // Asleep, the necks drop forward so each head rests on the floor.
      h.head.rotation.x = headPitch - this.lower * 1.25 + noise1(t * 0.5, h.phase + 4) * 0.15 * sway;
      h.neck.rotation.x = this.lower * 1.85 - this.lungeAmt * 0.3 + noise1(t * 0.3, h.phase + 8) * 0.08 * sway;
      h.jaw.rotation.x = this.jawOpen * (0.7 + 0.3 * Math.sin(t * 2 + h.phase));
      for (const e of h.eyes) e.scale.y = Math.max(0.08, this.eyeOpen);
    }
    this.tail.rotation.y = Math.sin(t * (this.lower > 0.5 ? 0.6 : 3)) * 0.4;
    this.tail.rotation.x = easeInCubic(this.lower) * 0.6;
  }
}
