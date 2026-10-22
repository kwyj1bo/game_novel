import * as THREE from "three";
import type { ActorSpec, AnimClip } from "../story/schema";
import { clamp, damp, easeInCubic, envelope, lerp, noise1, rng, smoothstep } from "../core/math";
import { Actor } from "./Actor";

const CLIP_SECONDS: Partial<Record<AnimClip, number>> = {
  roar: 1.8,
  lunge: 1.3,
  fall: 1.6,
  shake: 1.2,
  nod: 1.0,
  cower: 1.4,
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

function joint(parent: THREE.Object3D, pos: [number, number, number]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

// A mountain troll: lumpy body, tiny head, long arms, a club in the right hand.
// "lunge" swings the club overhead and down; "fall" topples it backwards.
export class Troll extends Actor {
  private readonly k: number;
  private readonly body: THREE.Group;
  private readonly torso: THREE.Group;
  private readonly head: THREE.Group;
  private readonly jaw: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly elbowL: THREE.Group;
  private readonly elbowR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly handR: THREE.Group;
  readonly club: THREE.Group;
  private readonly cur = { pitch: 0, lift: 0, armRX: 0, armRZ: 0, elbowR: 0, armLX: 0, spineX: 0, jaw: 0.1, headX: 0 };

  constructor(id: string, spec: ActorSpec) {
    super(id, spec);
    const k = (this.k = spec.height / 3.6);
    const skin = new THREE.MeshStandardMaterial({ color: spec.skin, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.skin).multiplyScalar(0.7), roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: spec.robe, roughness: 1 });
    const rand = rng(17);

    this.body = joint(this.root, [0, 0, 0]);
    const hips = joint(this.body, [0, 1.35 * k, 0]);
    // Loincloth.
    add(hips, new THREE.CylinderGeometry(0.75 * k, 0.85 * k, 0.6 * k, 10), cloth, [0, -0.1 * k, 0], undefined, [1, 1, 0.8]);

    const makeLeg = (x: number) => {
      const leg = joint(hips, [x * k, -0.2 * k, 0]);
      add(leg, new THREE.CapsuleGeometry(0.32 * k, 0.5 * k, 6, 10), skin, [0, -0.45 * k, 0]);
      add(leg, new THREE.CapsuleGeometry(0.3 * k, 0.3 * k, 6, 10), skin, [0, -0.95 * k, 0.05 * k]);
      add(leg, new THREE.SphereGeometry(0.34 * k, 10, 8), dark, [0, -1.15 * k, 0.2 * k], undefined, [1, 0.45, 1.5]);
      return leg;
    };
    this.legL = makeLeg(0.42);
    this.legR = makeLeg(-0.42);

    this.torso = joint(hips, [0, 0.1 * k, 0]);
    // Pot belly and hunched chest, built from overlapping lumps.
    add(this.torso, new THREE.SphereGeometry(0.9 * k, 18, 14), skin, [0, 0.55 * k, 0.12 * k], undefined, [1, 0.95, 0.9]);
    add(this.torso, new THREE.SphereGeometry(0.85 * k, 18, 14), skin, [0, 1.25 * k, -0.05 * k], undefined, [1.15, 0.85, 0.85]);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const y = lerp(0.3, 1.5, rand()) * k;
      add(this.torso, new THREE.SphereGeometry(lerp(0.15, 0.3, rand()) * k, 8, 6), rand() < 0.5 ? skin : dark, [Math.cos(a) * 0.8 * k, y, Math.sin(a) * 0.72 * k]);
    }

    this.head = joint(this.torso, [0, 1.7 * k, 0.45 * k]);
    add(this.head, new THREE.SphereGeometry(0.3 * k, 14, 10), skin, [0, 0.05 * k, 0], undefined, [1, 0.85, 1]);
    add(this.head, new THREE.SphereGeometry(0.12 * k, 10, 8), dark, [0, 0, 0.3 * k], undefined, [1, 0.8, 1.2]);
    // Heavy brow over small mean eyes.
    add(this.head, new THREE.BoxGeometry(0.5 * k, 0.08 * k, 0.16 * k), dark, [0, 0.14 * k, 0.24 * k], [0.3, 0, 0]);
    const eye = new THREE.MeshStandardMaterial({ color: "#d8c860", emissive: new THREE.Color("#3a3000") });
    for (const s of [1, -1]) {
      add(this.head, new THREE.SphereGeometry(0.04 * k, 8, 6), eye, [s * 0.12 * k, 0.08 * k, 0.27 * k]);
      add(this.head, new THREE.SphereGeometry(0.08 * k, 8, 6), skin, [s * 0.3 * k, 0.05 * k, 0], undefined, [0.5, 1.3, 0.8]);
    }
    this.jaw = joint(this.head, [0, -0.1 * k, 0.05 * k]);
    add(this.jaw, new THREE.BoxGeometry(0.42 * k, 0.12 * k, 0.32 * k), skin, [0, -0.06 * k, 0.12 * k]);
    const tooth = new THREE.MeshStandardMaterial({ color: "#d9cfae", roughness: 0.5 });
    for (const s of [1, -1]) add(this.jaw, new THREE.ConeGeometry(0.03 * k, 0.12 * k, 5), tooth, [s * 0.14 * k, 0.04 * k, 0.24 * k]);

    const makeArm = (side: 1 | -1) => {
      const arm = joint(this.torso, [side * 1.0 * k, 1.35 * k, 0]);
      add(arm, new THREE.SphereGeometry(0.34 * k, 12, 10), skin, [0, 0, 0]);
      add(arm, new THREE.CapsuleGeometry(0.24 * k, 0.6 * k, 6, 10), skin, [0, -0.45 * k, 0]);
      const elbow = joint(arm, [0, -0.9 * k, 0]);
      add(elbow, new THREE.CapsuleGeometry(0.22 * k, 0.6 * k, 6, 10), skin, [0, -0.4 * k, 0]);
      const hand = joint(elbow, [0, -0.85 * k, 0]);
      add(hand, new THREE.SphereGeometry(0.24 * k, 10, 8), dark, [0, 0, 0], undefined, [1, 1.1, 0.9]);
      return [arm, elbow, hand] as const;
    };
    [this.armL, this.elbowL] = makeArm(1);
    [this.armR, this.elbowR, this.handR] = makeArm(-1);

    // Club: a knobbly tapered log gripped in the right hand, pointing forward.
    this.club = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: "#5a4128", roughness: 0.95 });
    add(this.club, new THREE.CylinderGeometry(0.22 * k, 0.09 * k, 1.9 * k, 10), wood, [0, 0.75 * k, 0]);
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      add(this.club, new THREE.SphereGeometry(0.08 * k, 6, 5), wood, [Math.cos(a) * 0.18 * k, (1.1 + rand() * 0.5) * k, Math.sin(a) * 0.18 * k]);
    }
    this.club.rotation.x = Math.PI / 2 + 0.3;
    this.handR.add(this.club);
  }

  get height(): number {
    return this.spec.height;
  }

  socket(name: string): THREE.Object3D {
    if (name === "club") return this.club;
    if (name === "hand_r") return this.handR;
    return this.root;
  }

  protected clipDuration(clip: AnimClip): number {
    return CLIP_SECONDS[clip] ?? 1.2;
  }

  protected walkSpeed(): number {
    return 1.1;
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return this.head.getWorldPosition(out);
  }

  castPoint(out: THREE.Vector3): THREE.Vector3 {
    this.handR.updateWorldMatrix(true, false);
    return this.handR.getWorldPosition(out);
  }

  protected pose(dt: number): void {
    const t = this.time;
    const k = this.k;
    const target = { pitch: 0, lift: 0, armRX: -0.3, armRZ: -0.2, elbowR: -0.5, armLX: 0.1, spineX: 0.25, jaw: 0.12 + Math.max(0, noise1(t, 3)) * 0.1, headX: -0.1 };
    const c = this.clipState();
    if (c) {
      const w = envelope(c.u, 0.2, 0.2, c.hold);
      switch (c.name) {
        case "roar":
          target.jaw = lerp(target.jaw, 0.7, w);
          target.headX = lerp(target.headX, -0.5, w);
          target.armLX = lerp(target.armLX, -1.2, w);
          target.armRX = lerp(target.armRX, -1.4, w);
          target.spineX = lerp(target.spineX, -0.1, w);
          break;
        case "lunge": {
          // Wind up overhead, then smash down.
          const up = smoothstep(c.u / 0.45);
          const down = smoothstep((c.u - 0.45) / 0.15);
          target.armRX = lerp(lerp(-0.3, -2.9, up), -0.9, down);
          target.elbowR = lerp(-0.5, -0.2, up);
          target.spineX = lerp(lerp(0.25, -0.2, up), 0.55, down);
          target.jaw = 0.5;
          break;
        }
        case "fall": {
          const f = easeInCubic(clamp(c.u * 1.1, 0, 1));
          target.pitch = -1.45 * (c.hold ? f : w * f);
          target.lift = 0.6 * k * f;
          target.armRX = -1.6;
          target.armLX = -1.6;
          target.jaw = 0.4;
          break;
        }
        case "shake":
          target.headX = Math.sin(c.u * Math.PI * 6) * 0.3;
          break;
        case "cower":
          target.spineX = lerp(target.spineX, 0.6, w);
          target.armLX = lerp(target.armLX, -1.8, w);
          break;
        default:
          break;
      }
    }
    for (const key of Object.keys(target) as (keyof typeof target)[]) this.cur[key] = damp(this.cur[key], target[key], 10, dt);

    // Lumbering walk: big side-to-side sway.
    const phase = (this.gait / (1.4 * k)) * Math.PI;
    const amp = clamp(this.speed / this.walkSpeed(), 0, 1);
    const s = Math.sin(phase);
    this.legL.rotation.x = -s * 0.45 * amp;
    this.legR.rotation.x = s * 0.45 * amp;
    this.body.rotation.set(this.cur.pitch, 0, s * 0.08 * amp + noise1(t * 0.4, 7) * 0.03);
    this.body.position.y = this.cur.lift + Math.abs(Math.cos(phase)) * 0.06 * k * amp;
    this.torso.rotation.x = this.cur.spineX + Math.sin(t * 1.2) * 0.02;
    this.head.rotation.x = this.cur.headX;
    this.head.rotation.y = noise1(t * 0.3, 2) * 0.4;
    this.jaw.rotation.x = this.cur.jaw;
    this.armL.rotation.x = this.cur.armLX + s * 0.35 * amp;
    this.armL.rotation.z = 0.25;
    this.armR.rotation.x = this.cur.armRX - s * 0.25 * amp;
    this.armR.rotation.z = this.cur.armRZ;
    this.elbowR.rotation.x = this.cur.elbowR;
    this.elbowL.rotation.x = -0.4;
  }
}
