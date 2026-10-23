import * as THREE from "three";
import type { ActorSpec, AnimClip } from "../story/schema";
import { clamp, damp, easeInCubic, easeOutCubic, envelope, lerp, noise1, rng, smoothstep } from "../core/math";
import { Actor } from "./Actor";

// Joint targets the animation layers write into; the rig damps toward them.
interface Pose {
  bodyY: number;
  bodyPitch: number;
  bodyRoll: number;
  hipsY: number;
  spineX: number;
  spineY: number;
  spineZ: number;
  neckX: number;
  neckY: number;
  neckZ: number;
  lShoulderX: number;
  lShoulderZ: number;
  lElbowX: number;
  rShoulderX: number;
  rShoulderZ: number;
  rElbowX: number;
  lHipX: number;
  lKneeX: number;
  rHipX: number;
  rKneeX: number;
}

type PoseKey = keyof Pose;

const CLIP_SECONDS: Partial<Record<AnimClip, number>> = {
  wave: 1.8,
  point: 1.6,
  cast: 1.1,
  nod: 0.9,
  shake: 1.1,
  cower: 1.4,
  fall: 1.1,
  kneel: 1.0,
  jump: 0.9,
  struggle: 2.6,
  reach: 1.3,
  drink: 2.2,
  celebrate: 2.0,
  play_flute: 4.0,
  laugh: 1.8,
  unwrap: 2.2,
  crumble: 3.0,
  sleep: 1.4,
  pat: 1.6,
  hug: 2.0,
  push: 0.9,
  stagger: 1.1,
  give: 1.5,
  sit: 1.0,
  lean: 1.2,
};

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();

function mat(color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  pos: [number, number, number] = [0, 0, 0],
  scale?: [number, number, number],
  rot?: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(parent: THREE.Object3D, pos: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

export class Human extends Actor {
  private readonly k: number;
  private readonly r: number;
  private readonly hipH: number;
  private readonly body: THREE.Group;
  private readonly hips: THREE.Group;
  private readonly spine: THREE.Group;
  private readonly neck: THREE.Group;
  private readonly head: THREE.Group;
  private readonly shoulderL: THREE.Group;
  private readonly shoulderR: THREE.Group;
  private readonly elbowL: THREE.Group;
  private readonly elbowR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly kneeL: THREE.Group;
  private readonly kneeR: THREE.Group;
  private readonly wandTip: THREE.Object3D;
  private readonly handR: THREE.Group;
  private readonly flute: THREE.Mesh;
  private readonly mouth: THREE.Mesh;
  private readonly eyes: THREE.Group[] = [];
  private readonly brows: THREE.Mesh[] = [];
  private turban: THREE.Group | null = null;
  private backFace: THREE.Group | null = null;
  private readonly allMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly baseColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private crumbleU = 0;
  // Once revealed or turned to ash, later clips must not undo it.
  private unwrapped = false;
  private crumbled = false;
  private nextBlink = 2;
  private blink = 0;
  private readonly seed: number;
  private readonly cur: Pose = Human.neutral();

  constructor(id: string, spec: ActorSpec) {
    super(id, spec);
    const k = (this.k = spec.height / 1.6);
    const r = (this.r = 0.12 * k);
    this.seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
    this.hipH = 0.78 * k;

    const robe = mat(spec.robe, 0.9, { side: THREE.DoubleSide });
    const trim = mat(spec.trim ?? spec.robe, 0.8);
    const skin = mat(spec.skin, 0.55);
    const trousers = mat("#26262c", 0.9);
    const shoe = mat("#141210", 0.5);

    this.body = joint(this.root, [0, 0, 0]);
    this.hips = joint(this.body, [0, this.hipH, 0]);

    // Robe skirt: a flared lathe from the waist to just below the knee.
    const skirtProfile = [
      new THREE.Vector2(0.155 * k, 0.04 * k),
      new THREE.Vector2(0.17 * k, -0.1 * k),
      new THREE.Vector2(0.21 * k, -0.35 * k),
      new THREE.Vector2(0.25 * k, -0.56 * k),
      new THREE.Vector2(0.235 * k, -0.58 * k),
    ];
    add(this.hips, new THREE.LatheGeometry(skirtProfile, 20), robe, [0, 0, 0], [1, 1, 0.82]);

    const thighL = 0.39 * k;
    const shinL = 0.35 * k;
    const makeLeg = (x: number) => {
      const leg = joint(this.hips, [x, 0, 0]);
      add(leg, new THREE.CapsuleGeometry(0.062 * k, thighL - 0.1 * k, 4, 10), trousers, [0, -thighL / 2, 0]);
      const knee = joint(leg, [0, -thighL, 0]);
      add(knee, new THREE.CapsuleGeometry(0.052 * k, shinL - 0.08 * k, 4, 10), trousers, [0, -shinL / 2, 0]);
      add(knee, new THREE.BoxGeometry(0.1 * k, 0.08 * k, 0.22 * k), shoe, [0, -shinL, 0.05 * k]);
      return [leg, knee] as const;
    };
    [this.legL, this.kneeL] = makeLeg(0.085 * k);
    [this.legR, this.kneeR] = makeLeg(-0.085 * k);

    this.spine = joint(this.hips, [0, 0.02 * k, 0]);
    const torsoL = 0.5 * k;
    add(this.spine, new THREE.CylinderGeometry(0.185 * k, 0.155 * k, torsoL, 16), robe, [0, torsoL / 2, 0], [1, 1, 0.72]);
    // Shoulder cap rounds off the top of the torso.
    add(this.spine, new THREE.SphereGeometry(0.185 * k, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), robe, [0, torsoL, 0], [1, 0.45, 0.72]);
    const chest = joint(this.spine, [0, torsoL, 0]);
    // School uniform under the open robe: grey jumper, white collar.
    if (spec.outfit === "student") {
      const jumper = mat("#55565e", 0.95);
      add(this.spine, new THREE.BoxGeometry(0.17 * k, 0.4 * k, 0.04 * k), jumper, [0, torsoL * 0.55, 0.115 * k], undefined, [-0.04, 0, 0]);
      add(this.hips, new THREE.BoxGeometry(0.15 * k, 0.5 * k, 0.03 * k), mat("#2e2e34", 0.95), [0, -0.27 * k, 0.17 * k], undefined, [-0.12, 0, 0]);
      const shirt = mat("#eeeae0", 0.7);
      for (const s of [1, -1]) add(chest, new THREE.BoxGeometry(0.06 * k, 0.012 * k, 0.05 * k), shirt, [s * 0.035 * k, -0.035 * k, 0.12 * k], undefined, [0.3, 0, s * 0.5]);
    }
    // Hood folded down at the back of the robe.
    add(chest, new THREE.SphereGeometry(0.13 * k, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), robe, [0, 0.0, -0.1 * k], [1.1, 0.8, 0.7]);
    // Scarf / collar in the trim colour.
    add(chest, new THREE.TorusGeometry(0.095 * k, 0.04 * k, 8, 18), trim, [0, 0.03 * k, 0], [1, 1, 0.9], [Math.PI / 2, 0, 0]);
    add(chest, new THREE.BoxGeometry(0.07 * k, 0.24 * k, 0.03 * k), trim, [0.05 * k, -0.1 * k, 0.12 * k], undefined, [0.15, 0, 0.12]);

    this.neck = joint(chest, [0, 0.03 * k, 0]);
    add(this.neck, new THREE.CylinderGeometry(0.045 * k, 0.05 * k, 0.1 * k, 10), skin, [0, 0.04 * k, 0]);
    this.head = joint(this.neck, [0, 0.07 * k + r, 0.01 * k]);
    this.mouth = this.buildHead(skin, spec);

    const upperL = 0.27 * k;
    const foreL = 0.25 * k;
    const makeArm = (side: 1 | -1) => {
      const shoulder = joint(chest, [side * 0.19 * k, -0.05 * k, 0]);
      add(shoulder, new THREE.SphereGeometry(0.064 * k, 12, 8), robe, [0, 0, 0]);
      add(shoulder, new THREE.CylinderGeometry(0.062 * k, 0.07 * k, upperL, 12), robe, [0, -upperL / 2, 0]);
      const elbow = joint(shoulder, [0, -upperL, 0]);
      // Wide sleeve cuff.
      add(elbow, new THREE.SphereGeometry(0.066 * k, 10, 8), robe, [0, 0, 0]);
      add(elbow, new THREE.CylinderGeometry(0.064 * k, 0.1 * k, foreL * 0.85, 14, 1, true), robe, [0, -foreL * 0.42, 0]);
      add(elbow, new THREE.CylinderGeometry(0.035 * k, 0.04 * k, foreL * 0.8, 8), skin, [0, -foreL * 0.55, 0]);
      const hand = joint(elbow, [0, -foreL, 0]);
      // Mitten hand: palm, curled fingers and a thumb on the inner side.
      add(hand, new THREE.CapsuleGeometry(0.03 * k, 0.04 * k, 4, 8), skin, [0, -0.03 * k, 0], [1.1, 1, 0.75]);
      add(hand, new THREE.CapsuleGeometry(0.022 * k, 0.03 * k, 4, 8), skin, [0, -0.075 * k, 0.012 * k], [1.3, 0.9, 0.9], [0.5, 0, 0]);
      add(hand, new THREE.CapsuleGeometry(0.012 * k, 0.03 * k, 4, 6), skin, [-side * 0.03 * k, -0.035 * k, 0.018 * k], undefined, [0.4, 0, -side * 0.5]);
      return [shoulder, elbow, hand] as const;
    };
    let handR: THREE.Group;
    [this.shoulderL, this.elbowL] = makeArm(1);
    [this.shoulderR, this.elbowR, handR] = makeArm(-1);
    this.handR = handR;

    // Wand in the right hand, angled forward out of the fist.
    const wand = joint(handR, [0, -0.02 * k, 0.01 * k]);
    wand.rotation.x = -1.25;
    const wandL = 0.3 * k;
    add(wand, new THREE.CylinderGeometry(0.006 * k, 0.011 * k, wandL, 6), mat("#3d2614", 0.6), [0, -wandL / 2, 0]);
    this.wandTip = joint(wand, [0, -wandL, 0]);

    this.flute = add(handR, new THREE.CylinderGeometry(0.012 * k, 0.012 * k, 0.32 * k, 8), mat("#a07a4a", 0.5), [0.08 * k, -0.03 * k, 0.06 * k], undefined, [0, 0, Math.PI / 2.4]);
    this.flute.visible = false;

    if (spec.ghost) {
      // Pearly, see-through and faintly glowing.
      this.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
          const m = o.material;
          m.color.lerp(new THREE.Color("#dfe8ff"), 0.6);
          m.emissive = new THREE.Color("#7f9ad8");
          m.emissiveIntensity = 0.5;
          m.transparent = true;
          m.opacity = 0.45;
          m.depthWrite = false;
          o.castShadow = false;
        }
      });
    }
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        if (!this.allMaterials.includes(o.material)) {
          this.allMaterials.push(o.material);
          this.baseColors.set(o.material, o.material.color.clone());
        }
      }
    });
  }

  private buildHead(skin: THREE.Material, spec: ActorSpec): THREE.Mesh {
    const r = this.r;
    const h = this.head;
    const hair = mat(spec.hair, 0.75);
    add(h, new THREE.SphereGeometry(r, 28, 20), skin, [0, 0, 0], [0.94, 1.02, 0.98]);
    // Jaw/cheeks give the face a chin.
    add(h, new THREE.SphereGeometry(r * 0.78, 20, 14), skin, [0, -r * 0.38, r * 0.12], [1, 0.85, 1]);
    // Ears.
    for (const s of [1, -1]) add(h, new THREE.SphereGeometry(r * 0.2, 10, 8), skin, [s * r * 0.93, -r * 0.05, 0], [0.5, 1, 0.8]);
    // Nose.
    add(h, new THREE.SphereGeometry(r * 0.14, 12, 10), skin, [0, -r * 0.12, r * 0.98], [0.9, 1, 1.3]);

    const white = mat("#f4f1ea", 0.25);
    const iris = mat(spec.eyes, 0.3);
    const pupil = mat("#0a0a0a", 0.2);
    for (const s of [1, -1]) {
      const eye = joint(h, [s * r * 0.36, r * 0.1, r * 0.83]);
      add(eye, new THREE.SphereGeometry(r * 0.19, 14, 10), white, [0, 0, 0], [1, 1, 0.55]);
      add(eye, new THREE.SphereGeometry(r * 0.11, 12, 10), iris, [0, 0, r * 0.08], [1, 1, 0.5]);
      add(eye, new THREE.SphereGeometry(r * 0.055, 10, 8), pupil, [0, 0, r * 0.12], [1, 1, 0.5]);
      this.eyes.push(eye);
      // Upper lid shades the top of the eye and gives it shape.
      add(h, new THREE.SphereGeometry(r * 0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), skin, [s * r * 0.36, r * 0.11, r * 0.8], [1, 0.9, 0.62], [0.35, 0, 0]);
      add(h, new THREE.SphereGeometry(r * 0.16, 10, 8), mat("#e89a8a", 0.7, { transparent: true, opacity: 0.35 }), [s * r * 0.48, -r * 0.22, r * 0.72], [1, 0.6, 0.3]);
      const brow = add(h, new THREE.BoxGeometry(r * 0.4, r * 0.09, r * 0.09), hair, [s * r * 0.36, r * 0.4, r * 0.88], undefined, [0, 0, -s * 0.08]);
      this.brows.push(brow);
    }
    const mouth = add(h, new THREE.SphereGeometry(r * 0.15, 14, 10), mat("#6a2a2a", 0.6), [0, -r * 0.5, r * 0.86], [1, 0.15, 0.45]);
    // Lower lip catches a little light under the mouth.
    add(h, new THREE.SphereGeometry(r * 0.1, 10, 8), mat(spec.skin, 0.5, { color: new THREE.Color(spec.skin).multiplyScalar(0.88) }), [0, -r * 0.6, r * 0.88], [1.2, 0.35, 0.5]);

    this.buildHair(hair, spec);
    this.buildGlasses(spec);
    if (spec.hat === "witch") {
      const felt = mat(spec.trim ?? spec.robe, 0.9, { side: THREE.DoubleSide });
      const hat = joint(h, [0, r * 0.75, -r * 0.05]);
      hat.rotation.x = -0.12;
      add(hat, new THREE.CylinderGeometry(r * 2.1, r * 2.1, r * 0.06, 28), felt, [0, 0, 0]);
      // Tall cone with a crooked tip.
      add(hat, new THREE.ConeGeometry(r * 0.95, r * 2.2, 24, 1, true), felt, [0, r * 1.1, 0]);
      add(hat, new THREE.ConeGeometry(r * 0.32, r * 0.9, 12), felt, [r * 0.18, r * 2.3, -r * 0.1], undefined, [0, 0, -0.5]);
    }
    if (spec.beard !== "none") this.buildBeard(hair, spec);
    if (spec.scar) {
      const scar = mat("#9a3a32", 0.6);
      add(h, new THREE.BoxGeometry(r * 0.04, r * 0.18, r * 0.03), scar, [r * 0.22, r * 0.62, r * 0.83], undefined, [0.5, 0, 0.5]);
      add(h, new THREE.BoxGeometry(r * 0.04, r * 0.16, r * 0.03), scar, [r * 0.27, r * 0.5, r * 0.88], undefined, [0.45, 0, -0.5]);
    }
    return mouth;
  }

  private buildHair(hair: THREE.Material, spec: ActorSpec): void {
    const r = this.r;
    const h = this.head;
    const rand = rng(this.seed);
    const cap = (scale = 1.07, tilt = -0.42) =>
      add(h, new THREE.SphereGeometry(r * scale, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, [0, r * 0.02, -r * 0.02], undefined, [tilt, 0, 0]);
    const tufts = (n: number, size: number, spread: number, minY: number) => {
      for (let i = 0; i < n; i++) {
        const th = rand() * Math.PI * 2;
        const y = lerp(minY, 1, rand());
        const rr = Math.sqrt(1 - y * y);
        const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
        if (dir.z > 0.55 && dir.y < 0.55) continue;
        const m = add(h, new THREE.ConeGeometry(r * size, r * size * 2.4, 6), hair, [0, 0, 0]);
        m.position.copy(dir.clone().multiplyScalar(r * spread));
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.add(new THREE.Vector3((rand() - 0.5) * 0.6, 0.2, (rand() - 0.5) * 0.6)).normalize());
      }
    };
    // Soft elongated clumps pointing outward: tousled rather than spiky.
    const clumps = (n: number, size: number, spread: number, minY: number) => {
      for (let i = 0; i < n; i++) {
        const th = rand() * Math.PI * 2;
        const y = lerp(minY, 1, rand());
        const rr = Math.sqrt(1 - y * y);
        const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
        if (dir.z > 0.5 && dir.y < 0.5) continue;
        const m = add(h, new THREE.SphereGeometry(r * size, 8, 6), hair, [0, 0, 0], [0.55, 1.25, 0.55]);
        m.position.copy(dir.clone().multiplyScalar(r * spread));
        const tilt = dir.add(new THREE.Vector3((rand() - 0.5) * 0.8, 0.1, (rand() - 0.5) * 0.8)).normalize();
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tilt);
      }
    };
    switch (spec.hairStyle) {
      case "messy":
        cap(1.08);
        clumps(30, 0.3, 1.0, 0.1);
        break;
      case "ginger_mop":
        cap(1.1, -0.3);
        add(h, new THREE.SphereGeometry(r * 0.75, 16, 10), hair, [0, r * 0.62, r * 0.42], [1.25, 0.5, 0.7]);
        tufts(12, 0.2, 1.04, 0.3);
        break;
      case "bushy":
        cap(1.12);
        for (let i = 0; i < 34; i++) {
          const th = rand() * Math.PI * 2;
          const y = lerp(-0.85, 1, rand());
          const rr = Math.sqrt(1 - y * y);
          const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
          if (dir.z > 0.35 && dir.y < 0.6) continue;
          const s = r * lerp(0.36, 0.52, rand());
          add(h, new THREE.SphereGeometry(s, 10, 8), hair, [dir.x * r * 1.12, dir.y * r * 1.05 - (dir.y < 0 ? r * 0.35 : 0), dir.z * r * 1.05 - r * 0.08]);
        }
        break;
      case "long":
        cap(1.08, -0.25);
        for (const s of [1, -1]) {
          add(h, new THREE.BoxGeometry(r * 0.32, r * 2.0, r * 1.2), hair, [s * r * 0.92, -r * 0.55, -r * 0.08], undefined, [0, 0, s * 0.05]);
        }
        add(h, new THREE.BoxGeometry(r * 1.7, r * 1.9, r * 0.3), hair, [0, -r * 0.5, -r * 0.88]);
        break;
      case "bun":
        cap(1.07);
        add(h, new THREE.SphereGeometry(r * 0.42, 14, 10), hair, [0, r * 0.62, -r * 0.82]);
        break;
      case "short":
        cap(1.06, -0.5);
        break;
      case "turban": {
        const cloth = mat("#5b2e6e", 0.85);
        const t = joint(h, [0, r * 0.25, -r * 0.03]);
        for (let i = 0; i < 4; i++) {
          add(t, new THREE.TorusGeometry(r * (1.0 - i * 0.14), r * 0.2, 10, 24), cloth, [0, i * r * 0.22, 0], undefined, [Math.PI / 2 + (i % 2 ? 0.12 : -0.12), 0, 0]);
        }
        add(t, new THREE.SphereGeometry(r * 0.78, 16, 10), cloth, [0, r * 0.45, 0], [1, 0.7, 1]);
        this.turban = t;
        this.backFace = this.buildBackFace();
        break;
      }
      case "bald":
        break;
    }
  }

  // The face hidden under the turban, on the back of the head.
  private buildBackFace(): THREE.Group {
    const r = this.r;
    const g = joint(this.head, [0, 0, -r * 0.86]);
    g.rotation.y = Math.PI;
    const pale = mat("#d9d6cc", 0.4, { emissive: new THREE.Color("#2a2a24") });
    add(g, new THREE.SphereGeometry(r * 0.62, 18, 12), pale, [0, 0, 0], [1, 1.15, 0.35]);
    const red = new THREE.MeshStandardMaterial({ color: "#ff2010", emissive: new THREE.Color("#ff1a00"), emissiveIntensity: 4 });
    for (const s of [1, -1]) add(g, new THREE.SphereGeometry(r * 0.09, 10, 6), red, [s * r * 0.24, r * 0.12, r * 0.18], [1.6, 0.55, 0.5], [0, 0, s * 0.35]);
    const slit = mat("#1a0a0a", 0.5);
    for (const s of [1, -1]) add(g, new THREE.BoxGeometry(r * 0.03, r * 0.12, r * 0.04), slit, [s * r * 0.05, -r * 0.08, r * 0.21]);
    add(g, new THREE.BoxGeometry(r * 0.4, r * 0.03, r * 0.04), slit, [0, -r * 0.32, r * 0.18]);
    g.visible = false;
    return g;
  }

  private buildGlasses(spec: ActorSpec): void {
    if (spec.glasses === "none") return;
    const r = this.r;
    const frame = mat("#1c1c1c", 0.3, { metalness: 0.7 });
    if (spec.glasses === "halfmoon") frame.color.set("#b8962e");
    for (const s of [1, -1]) {
      const pos: [number, number, number] = [s * r * 0.36, r * 0.08, r * 1.0];
      if (spec.glasses === "round") add(this.head, new THREE.TorusGeometry(r * 0.21, r * 0.022, 6, 24), frame, pos);
      if (spec.glasses === "square") add(this.head, new THREE.TorusGeometry(r * 0.24, r * 0.022, 6, 4), frame, pos, undefined, [0, 0, Math.PI / 4]);
      if (spec.glasses === "halfmoon")
        add(this.head, new THREE.TorusGeometry(r * 0.2, r * 0.02, 6, 16, Math.PI), frame, [pos[0], pos[1] - r * 0.06, pos[2]], undefined, [0, 0, Math.PI]);
      // Arm of the glasses back to the ear.
      add(this.head, new THREE.BoxGeometry(r * 0.02, r * 0.02, r * 0.85), frame, [s * r * 0.6, r * 0.08, r * 0.55], undefined, [0, s * 0.18, 0]);
    }
    add(this.head, new THREE.BoxGeometry(r * 0.2, r * 0.025, r * 0.025), frame, [0, r * 0.12, r * 1.02]);
  }

  private buildBeard(hair: THREE.Material, spec: ActorSpec): void {
    const r = this.r;
    if (spec.beard === "long") {
      add(this.head, new THREE.ConeGeometry(r * 0.62, r * 3.4, 14), hair, [0, -r * 2.0, r * 0.5], [1, 1, 0.6], [Math.PI + 0.12, 0, 0]);
      add(this.head, new THREE.SphereGeometry(r * 0.66, 16, 10), hair, [0, -r * 0.55, r * 0.45], [1, 0.8, 0.7]);
    } else {
      const rand = rng(this.seed + 7);
      // Bushy beard on the jaw and cheeks, below the eyes.
      for (let i = 0; i < 26; i++) {
        const a = lerp(-1.5, 1.5, rand());
        const y = lerp(-1.2, -0.38, rand());
        const front = Math.cos(a);
        add(this.head, new THREE.SphereGeometry(r * lerp(0.24, 0.36, rand()), 10, 8), hair, [Math.sin(a) * r * 0.86, y * r - front * r * 0.08, front * r * 0.78]);
      }
    }
    // Moustache, with a gap so the mouth still shows.
    for (const s of [1, -1]) add(this.head, new THREE.CapsuleGeometry(r * 0.08, r * 0.3, 4, 8), hair, [s * r * 0.2, -r * 0.33, r * 0.92], undefined, [0, 0, s * 1.2]);
  }

  get height(): number {
    return this.spec.height;
  }

  socket(name: string): THREE.Object3D {
    if (name === "hand_r") return this.handR;
    if (name === "hips") return this.hips;
    return this.root;
  }

  protected clipDuration(clip: AnimClip): number {
    return CLIP_SECONDS[clip] ?? 1.2;
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    this.head.updateWorldMatrix(true, false);
    return this.head.getWorldPosition(out);
  }

  castPoint(out: THREE.Vector3): THREE.Vector3 {
    this.wandTip.updateWorldMatrix(true, false);
    return this.wandTip.getWorldPosition(out);
  }

  private static neutral(): Pose {
    return {
      bodyY: 0,
      bodyPitch: 0,
      bodyRoll: 0,
      hipsY: 0,
      spineX: 0,
      spineY: 0,
      spineZ: 0,
      neckX: 0,
      neckY: 0,
      neckZ: 0,
      lShoulderX: 0,
      lShoulderZ: 0.1,
      lElbowX: -0.15,
      rShoulderX: 0,
      rShoulderZ: -0.1,
      rElbowX: -0.25,
      lHipX: 0,
      lKneeX: 0,
      rHipX: 0,
      rKneeX: 0,
    };
  }

  protected pose(dt: number): void {
    const t = this.time;
    const k = this.k;
    const p = Human.neutral();

    // Idle: breathing and a slow weight shift.
    p.spineX = Math.sin(t * 1.6 + this.seed) * 0.018;
    p.bodyRoll = noise1(t * 0.3, this.seed) * 0.015;
    p.neckY = noise1(t * 0.4, this.seed + 3) * 0.08;
    p.neckX = noise1(t * 0.35, this.seed + 5) * 0.05;

    // Airborne (on a broom): legs tucked, slight forward lean, no walk cycle.
    const flying = this.root.position.y > 0.25;
    if (flying) {
      p.lHipX = p.rHipX = -0.9;
      p.lKneeX = p.rKneeX = 1.2;
      p.spineX = 0.25 + clamp(this.speed / 4, 0, 1) * 0.2;
      p.lShoulderX = p.rShoulderX = -0.9;
      p.lElbowX = p.rElbowX = -0.6;
      p.bodyY = Math.sin(t * 2) * 0.03;
    }

    // Locomotion layer.
    const sp = this.speed;
    if (sp > 0.05 && !flying) {
      const run = clamp((sp - this.walkSpeed()) / (this.runSpeed() - this.walkSpeed()), 0, 1);
      const stride = lerp(0.62, 1.2, run) * k;
      const phase = (this.gait / stride) * Math.PI;
      const amp = clamp(sp / this.walkSpeed(), 0, 1) * lerp(0.5, 0.95, run);
      const s = Math.sin(phase);
      p.lHipX = -s * amp;
      p.rHipX = s * amp;
      p.lKneeX = Math.max(0, Math.sin(phase - 1.2)) * amp * lerp(1.1, 1.8, run);
      p.rKneeX = Math.max(0, Math.sin(phase + Math.PI - 1.2)) * amp * lerp(1.1, 1.8, run);
      p.lShoulderX = s * amp * 0.8;
      p.rShoulderX = -s * amp * 0.8;
      p.lElbowX = -0.3 - run * 1.0;
      p.rElbowX = -0.3 - run * 1.0;
      p.bodyY = Math.abs(Math.cos(phase)) * 0.035 * k * amp;
      p.spineY = s * 0.12 * amp;
      p.spineX = lerp(0.04, 0.28, run);
    }

    // Look-at layer: head (and a bit of spine) turn toward the target.
    if (this.lookTarget) {
      const local = this.root.worldToLocal(TMP.copy(this.lookTarget));
      const headY = this.hipH + 0.6 * k;
      const yaw = Math.atan2(local.x, local.z);
      const pitch = Math.atan2(local.y - headY, Math.hypot(local.x, local.z));
      const cy = clamp(yaw, -1.2, 1.2);
      p.neckY += cy * 0.7;
      p.spineY += cy * 0.3;
      p.neckX += clamp(-pitch, -0.5, 0.6);
      // Turn the whole body when the target is too far round.
      if (Math.abs(yaw) > 1.25 && !this.move) this.face(this.lookTarget, false);
    }

    const c = this.clipState();
    if (c) this.applyClip(p, c.name, c.u, c.hold, t);
    else this.resetClipVisuals();

    if (this.speaking) {
      p.neckX += noise1(t * 2.5, this.seed) * 0.06;
      p.neckZ += noise1(t * 1.7, this.seed + 1) * 0.05;
    }

    this.writePose(p, dt);
    this.updateFace(dt, t);
  }

  private applyClip(p: Pose, name: AnimClip, u: number, hold: boolean, t: number): void {
    const k = this.k;
    const w = envelope(u, 0.18, 0.2, hold);
    const set = (vals: Partial<Pose>, weight = w) => {
      for (const key in vals) {
        const kk = key as PoseKey;
        p[kk] = lerp(p[kk], vals[kk]!, weight);
      }
    };
    switch (name) {
      case "wave":
        set({ rShoulderX: -0.2, rShoulderZ: -2.5, rElbowX: -0.5 + Math.sin(u * Math.PI * 7) * 0.45, neckZ: 0.08 });
        break;
      case "point":
        set({ rShoulderX: -1.5, rShoulderZ: -0.05, rElbowX: -0.05, spineY: -0.15, spineX: 0.08 });
        break;
      case "cast": {
        const wind = smoothstep(u / 0.4);
        const strike = smoothstep((u - 0.4) / 0.15);
        set({
          rShoulderX: lerp(lerp(0, -2.6, wind), -1.45, strike),
          rShoulderZ: lerp(-0.4, 0.05, strike),
          rElbowX: lerp(-1.2 * wind, -0.05, strike),
          spineX: lerp(-0.08 * wind, 0.14, strike),
          spineY: lerp(0.25 * wind, -0.2, strike),
          lShoulderZ: 0.5,
          lElbowX: -0.6,
        });
        break;
      }
      case "nod":
        set({ neckX: p.neckX + Math.sin(u * Math.PI * 3) * 0.28 });
        break;
      case "shake":
        set({ neckY: p.neckY + Math.sin(u * Math.PI * 5) * 0.38 });
        break;
      case "cower":
        set({
          hipsY: -0.16 * k,
          lHipX: -0.9,
          rHipX: -0.9,
          lKneeX: 1.5,
          rKneeX: 1.5,
          spineX: 0.55,
          neckX: 0.3,
          lShoulderX: -2.1,
          rShoulderX: -2.1,
          lElbowX: -2.3,
          rElbowX: -2.3,
          lShoulderZ: -0.3,
          rShoulderZ: 0.3,
        });
        break;
      case "fall":
      case "sleep": {
        const f = easeInCubic(clamp(u * 1.15, 0, 1));
        const fw = hold ? 1 : w;
        set({ bodyPitch: -1.48 * f, bodyY: 0.13 * k * f, lShoulderZ: 1.3, rShoulderZ: -1.3, lElbowX: -0.4, rElbowX: -0.4, lKneeX: 0.3, neckX: -0.2 }, fw);
        break;
      }
      case "kneel":
        set({ hipsY: -0.39 * k, lHipX: -1.5, lKneeX: 1.5, rHipX: 0.12, rKneeX: 1.62, spineX: 0.12, neckX: 0.15 });
        break;
      case "jump": {
        const crouch = u < 0.3 ? smoothstep(u / 0.3) : 1 - smoothstep((u - 0.3) / 0.15);
        const air = u > 0.3 && u < 0.8 ? Math.sin(((u - 0.3) / 0.5) * Math.PI) : 0;
        set({
          hipsY: -0.12 * k * crouch,
          lHipX: -0.7 * crouch,
          rHipX: -0.7 * crouch,
          lKneeX: 1.3 * crouch,
          rKneeX: 1.3 * crouch,
          bodyY: air * 0.32 * k,
          lShoulderZ: 0.3 + air * 2,
          rShoulderZ: -0.3 - air * 2,
        });
        break;
      }
      case "struggle":
        set({
          lShoulderX: -1.4 + noise1(t * 7, 1) * 1.1,
          rShoulderX: -1.4 + noise1(t * 7, 2) * 1.1,
          lShoulderZ: 0.6 + noise1(t * 5, 3) * 0.6,
          rShoulderZ: -0.6 + noise1(t * 5, 4) * 0.6,
          lElbowX: -1.2 + noise1(t * 6, 5),
          rElbowX: -1.2 + noise1(t * 6, 6),
          spineY: Math.sin(t * 8) * 0.35,
          spineX: 0.2,
          neckY: Math.sin(t * 6 + 1) * 0.4,
          neckX: -0.25,
          lHipX: noise1(t * 6, 7) * 0.4,
          rHipX: noise1(t * 6, 8) * 0.4,
        });
        break;
      case "reach":
        set({ rShoulderX: -1.65, rShoulderZ: 0.05, rElbowX: -0.02, spineX: 0.3, lShoulderZ: 0.4 });
        break;
      case "drink": {
        const up = smoothstep((u - 0.1) / 0.3);
        set({ rShoulderX: -0.75 * up, rShoulderZ: 0.4 * up, rElbowX: -2.35 * up, neckX: -0.45 * smoothstep((u - 0.35) / 0.2), spineX: -0.06 });
        break;
      }
      case "celebrate":
        set({
          lShoulderZ: 2.7,
          rShoulderZ: -2.7,
          lElbowX: -0.3,
          rElbowX: -0.3,
          bodyY: Math.abs(Math.sin(u * Math.PI * 4)) * 0.12 * k,
          neckX: -0.25,
        });
        break;
      case "play_flute":
        set({
          lShoulderX: -1.05,
          rShoulderX: -1.15,
          lShoulderZ: -0.35,
          rShoulderZ: 0.3,
          lElbowX: -2.05,
          rElbowX: -1.95,
          neckX: 0.12 + Math.sin(t * 4.2) * 0.07,
          neckZ: Math.sin(t * 2.1) * 0.06,
        });
        break;
      case "laugh":
        set({
          neckX: -0.4,
          spineX: -0.18 + Math.sin(t * 22) * 0.04,
          lShoulderZ: 0.45,
          rShoulderZ: -0.45,
          lElbowX: -0.9,
          rElbowX: -0.9,
        });
        break;
      case "pat": {
        // Right hand out and down onto a shoulder, a few small pats.
        const taps = u > 0.3 && u < 0.85 ? Math.sin((u - 0.3) * Math.PI * 10) * 0.15 : 0;
        set({ rShoulderX: -1.25 + taps, rShoulderZ: 0.15, rElbowX: -0.55 - taps, spineX: 0.1, neckX: 0.15 });
        break;
      }
      case "hug":
        set({ lShoulderX: -1.4, rShoulderX: -1.4, lShoulderZ: -0.55, rShoulderZ: 0.55, lElbowX: -1.0, rElbowX: -1.0, spineX: 0.18, neckX: 0.1 });
        break;
      case "push": {
        // Both palms thrust forward hard.
        const thrust = smoothstep((u - 0.15) / 0.2);
        set({ lShoulderX: -1.5 * thrust, rShoulderX: -1.5 * thrust, lElbowX: lerp(-1.6, -0.1, thrust), rElbowX: lerp(-1.6, -0.1, thrust), spineX: 0.3 * thrust });
        break;
      }
      case "stagger": {
        // Knocked back: lean away, arms flung out, then recover.
        const hit = Math.sin(clamp(u / 0.7, 0, 1) * Math.PI);
        set({ spineX: -0.45 * hit, neckX: -0.3 * hit, lShoulderZ: 1.1 * hit, rShoulderZ: -1.1 * hit, lHipX: 0.3 * hit, rHipX: -0.4 * hit, bodyY: -0.02 * k * hit });
        break;
      }
      case "sit":
        // Seated: hips down, thighs level, shins down.
        set({ hipsY: -0.36 * k, lHipX: -1.45, rHipX: -1.45, lKneeX: 1.45, rKneeX: 1.45, spineX: 0.05, lShoulderX: -0.5, rShoulderX: -0.5, lElbowX: -0.9, rElbowX: -0.9 });
        break;
      case "lean":
        set({ spineX: 0.45, neckX: -0.2, lShoulderX: -0.6, rShoulderX: -0.6, lElbowX: -0.8, rElbowX: -0.8 });
        break;
      case "give":
        // Right hand held out, palm up, at chest height.
        set({ rShoulderX: -1.1, rShoulderZ: 0.1, rElbowX: -0.7, spineX: 0.08 });
        break;
      case "unwrap":
        set({ lShoulderX: -2.7, rShoulderX: -2.7, lElbowX: -1.6, rElbowX: -1.6, lShoulderZ: 0.3, rShoulderZ: -0.3, neckX: 0.35 }, hold ? envelope(u, 0.15, 0.25) : w);
        break;
      case "crumble":
        set({ hipsY: -0.3 * k * easeInCubic(u), spineX: 0.5, neckX: 0.5, lShoulderZ: 0.9, rShoulderZ: -0.9, lKneeX: 1.2, rKneeX: 1.2, lHipX: -0.6, rHipX: -0.6 }, hold ? 1 : w);
        break;
      default:
        break;
    }
    this.flute.visible = name === "play_flute" && u < 0.97;
    if (name === "unwrap" && u >= 1) this.unwrapped = true;
    if (name === "crumble" && u >= 1) this.crumbled = true;
    if (this.turban && this.backFace) {
      const off = name === "unwrap" ? easeOutCubic(clamp((u - 0.2) / 0.6, 0, 1)) : 0;
      const turbanOff = this.unwrapped ? 1 : off;
      this.turban.scale.setScalar(1 - turbanOff * 0.999);
      this.turban.visible = turbanOff < 0.99;
      this.backFace.visible = turbanOff > 0.5;
    }
    this.applyCrumble(this.crumbled ? 1 : name === "crumble" ? u : 0);
  }

  private resetClipVisuals(): void {
    this.flute.visible = false;
    if (this.turban && this.backFace) {
      this.turban.scale.setScalar(this.unwrapped ? 0.001 : 1);
      this.turban.visible = !this.unwrapped;
      this.backFace.visible = this.unwrapped;
    }
    this.applyCrumble(this.crumbled ? 1 : 0);
  }

  private applyCrumble(u: number): void {
    if (u === this.crumbleU) return;
    this.crumbleU = u;
    const ash = new THREE.Color("#6d6a64");
    for (const m of this.allMaterials) {
      const base = this.baseColors.get(m)!;
      m.color.copy(base).lerp(ash, clamp(u * 1.6, 0, 1));
    }
    const s = 1 - smoothstep((u - 0.55) / 0.45);
    this.body.scale.set(lerp(1, 1.25, u), s, lerp(1, 1.25, u));
    this.body.visible = s > 0.01;
  }

  private writePose(p: Pose, dt: number): void {
    const c = this.cur;
    const L = 16;
    for (const key in p) {
      const kk = key as PoseKey;
      c[kk] = damp(c[kk], p[kk], L, dt);
    }
    this.body.position.y = c.bodyY;
    this.body.rotation.set(c.bodyPitch, 0, c.bodyRoll);
    this.hips.position.y = this.hipH + c.hipsY;
    this.spine.rotation.set(c.spineX, c.spineY, c.spineZ);
    this.neck.rotation.set(c.neckX * 0.4, c.neckY * 0.4, c.neckZ * 0.4);
    this.head.rotation.set(c.neckX * 0.6, c.neckY * 0.6, c.neckZ * 0.6);
    this.shoulderL.rotation.set(c.lShoulderX, 0, c.lShoulderZ);
    this.shoulderR.rotation.set(c.rShoulderX, 0, c.rShoulderZ);
    this.elbowL.rotation.x = c.lElbowX;
    this.elbowR.rotation.x = c.rElbowX;
    this.legL.rotation.x = c.lHipX;
    this.legR.rotation.x = c.rHipX;
    this.kneeL.rotation.x = c.lKneeX;
    this.kneeR.rotation.x = c.rKneeX;
  }

  private updateFace(dt: number, t: number): void {
    // Blink every few seconds.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.16;
      this.nextBlink = 2 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt);
    const lid = this.blink > 0 ? 0.1 : 1;
    for (const e of this.eyes) e.scale.y = damp(e.scale.y, lid, 40, dt);

    const open = this.speaking ? 0.18 + Math.max(0, noise1(t * 11, this.seed)) * 0.75 : 0.15;
    this.mouth.scale.y = damp(this.mouth.scale.y, open, 25, dt);

    // Brows lift a little while talking.
    const browLift = this.speaking ? Math.max(0, noise1(t * 1.3, this.seed + 9)) * this.r * 0.08 : 0;
    for (const b of this.brows) b.position.y = damp(b.position.y, this.r * 0.4 + browLift, 10, dt);
  }

  // Head position used for framing close-ups, slightly in front of the face.
  faceAnchor(out: THREE.Vector3): THREE.Vector3 {
    this.headPosition(out);
    TMP2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.r * 0.5);
    return out.add(TMP2);
  }
}
