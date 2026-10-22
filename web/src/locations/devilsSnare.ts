import * as THREE from "three";
import { damp, noise1, rng } from "../engine/core/math";
import { hdr } from "../engine/fx/Particles";
import type { LocationDef } from "../engine/world/Location";
import { flagstoneMaterial, mesh, stoneMaterial, torch, autoMarks, v3 } from "./kit";

const MARKS = {
  hole: v3(0, 6.6, 0),
  center: v3(0, 0, 0.3),
  land_harry: v3(0, 0, 0.6),
  land_ron: v3(1.4, 0, 1.3),
  land_hermione: v3(-1.4, 0, 1.1),
  passage: v3(0, 0, -5.6),
  passage_harry: v3(-0.4, 0, -4.4),
  passage_ron: v3(0.7, 0, -4.7),
  passage_hermione: v3(0.1, 0, -3.7),
  drag: v3(2.4, 0, -2.6),
  ...autoMarks(v3(0, 0, 0.6), v3(3.6, 3.6, 4.4), v3(0, 0, -5.4), 1.7),
};

const SEGMENTS = 36;
const RADIAL = 7;

// One vine: a tapered tube rebuilt in place each frame from a procedural spine.
class Vine {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly spine = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
  grip = 0;
  retreat = 0;

  constructor(
    readonly base: THREE.Vector3,
    readonly target: string,
    readonly length: number,
    readonly thickness: number,
    readonly seed: number,
    material: THREE.Material,
  ) {
    const geo = new THREE.BufferGeometry();
    const verts = (SEGMENTS + 1) * RADIAL;
    this.pos = new Float32Array(verts * 3);
    this.nrm = new Float32Array(verts * 3);
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = i * RADIAL + j;
        const b = i * RADIAL + ((j + 1) % RADIAL);
        const c = (i + 1) * RADIAL + j;
        const d = (i + 1) * RADIAL + ((j + 1) % RADIAL);
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("normal", new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(t: number, wrapAt: THREE.Vector3 | null, wrapHeight: number): void {
    const s = this.seed;
    const len = this.length * (1 - this.retreat * 0.85);
    const outward = this.base.clone().setY(0).normalize().negate();
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      // Resting: rises from the floor and writhes, leaning into the room.
      const p = this.spine[i];
      p.copy(this.base)
        .addScaledVector(outward, u * len * 0.55)
        .add(new THREE.Vector3(noise1(t * 0.6 + u * 3, s) * 0.5 * u, Math.sin(u * Math.PI * 0.9) * len * 0.45, noise1(t * 0.5 + u * 3, s + 9) * 0.5 * u));
      if (wrapAt && this.grip > 0.001) {
        // Gripping: run along the floor to the target, then coil up around it.
        const split = 0.45;
        const g = new THREE.Vector3();
        if (u < split) {
          g.lerpVectors(this.base, wrapAt, u / split);
          g.y = Math.sin((u / split) * Math.PI) * 0.15;
        } else {
          const w = (u - split) / (1 - split);
          const ang = s * 1.7 + w * Math.PI * 3.2 + t * 0.4;
          const r = 0.24 + Math.sin(t * 3 + s) * 0.015;
          g.set(wrapAt.x + Math.cos(ang) * r, 0.1 + w * wrapHeight, wrapAt.z + Math.sin(ang) * r);
        }
        p.lerp(g, this.grip);
      }
    }
    // Build rings with a rotation-minimising frame.
    const tangent = new THREE.Vector3();
    let normal = new THREE.Vector3(1, 0, 0);
    const binormal = new THREE.Vector3();
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = this.spine[Math.max(0, i - 1)];
      const b = this.spine[Math.min(SEGMENTS, i + 1)];
      tangent.subVectors(b, a).normalize();
      binormal.crossVectors(tangent, normal).normalize();
      if (binormal.lengthSq() < 1e-6) binormal.set(0, 0, 1);
      normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
      const u = i / SEGMENTS;
      const radius = this.thickness * (1 - u * 0.85) * (1 + Math.sin(u * 40 + s) * 0.08);
      for (let j = 0; j < RADIAL; j++) {
        const ang = (j / RADIAL) * Math.PI * 2;
        const nx = Math.cos(ang) * normal.x + Math.sin(ang) * binormal.x;
        const ny = Math.cos(ang) * normal.y + Math.sin(ang) * binormal.y;
        const nz = Math.cos(ang) * normal.z + Math.sin(ang) * binormal.z;
        const k = (i * RADIAL + j) * 3;
        this.nrm[k] = nx;
        this.nrm[k + 1] = ny;
        this.nrm[k + 2] = nz;
        this.pos[k] = this.spine[i].x + nx * radius;
        this.pos[k + 1] = this.spine[i].y + ny * radius;
        this.pos[k + 2] = this.spine[i].z + nz * radius;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }
}

export const devilsSnare: LocationDef = {
  id: "devils_snare",
  title: "Devil's Snare",
  info: {
    marks: Object.keys(MARKS),
    props: {
      vines: ["rest", "grip", "retreat"],
      light: ["dark", "bright"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const R = 6.2;
    const H = 7;
    const wall = stoneMaterial("#4c4a42", "pit", [7, 2.5]);
    wall.side = THREE.BackSide;
    root.add(mesh(new THREE.CylinderGeometry(R, R, H, 40, 1, true), wall, [0, H / 2, 0], [0, 0, 0], { cast: false }));
    const earth = flagstoneMaterial("#2e2a20", [4, 4]);
    root.add(mesh(new THREE.CircleGeometry(R, 40), earth, [0, 0, 0], [-Math.PI / 2, 0, 0], { cast: false }));
    // Ceiling with the trapdoor hole they fell through.
    const ceil = stoneMaterial("#33302a", "pitceil", [3, 3]);
    root.add(mesh(new THREE.RingGeometry(0.75, R, 40), ceil, [0, H, 0], [Math.PI / 2, 0, 0], { cast: false }));
    root.add(mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshBasicMaterial({ color: hdr("#d8c49a", 1.4) }), [0, H + 0.02, 0], [Math.PI / 2, 0, 0], { cast: false }));

    // Passage out at the back.
    root.add(mesh(new THREE.PlaneGeometry(1.8, 2.6), new THREE.MeshBasicMaterial({ color: "#0a0705" }), [0, 1.3, -R + 0.08], [0, 0, 0], { cast: false }));
    const archStone = stoneMaterial("#5c574c", "arch", [1, 1]);
    root.add(mesh(new THREE.BoxGeometry(0.35, 2.9, 0.4), archStone, [-1.05, 1.45, -R + 0.25]));
    root.add(mesh(new THREE.BoxGeometry(0.35, 2.9, 0.4), archStone, [1.05, 1.45, -R + 0.25]));
    root.add(mesh(new THREE.BoxGeometry(2.5, 0.4, 0.4), archStone, [0, 3.0, -R + 0.25]));
    const passageTorch = torch(ctx.particles, v3(1.6, 2.2, -R + 0.25), 0);
    root.add(passageTorch.group);

    const ambient = new THREE.HemisphereLight("#2a3324", "#0a0805", 0.35);
    root.add(ambient);
    const holeLight = new THREE.SpotLight("#e8d4a8", 40, 14, 0.5, 0.7, 1.4);
    holeLight.position.set(0, H + 0.5, 0);
    holeLight.target.position.set(0, 0, 0.5);
    holeLight.castShadow = true;
    holeLight.shadow.mapSize.set(1024, 1024);
    holeLight.shadow.bias = -0.0008;
    root.add(holeLight, holeLight.target);
    // Hermione's bluebell flames: off until the light prop goes bright.
    const blue = new THREE.PointLight("#5aa8ff", 0, 16, 1.6);
    blue.position.set(0, 1.0, 0.2);
    root.add(blue);

    const vineMat = new THREE.MeshStandardMaterial({ color: "#3b5e26", roughness: 0.5, metalness: 0.0 });
    const rand = rng(42);
    const vines: Vine[] = [];
    const targets = ["harry", "ron", "hermione"];
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + rand() * 0.2;
      const r = R * (0.45 + rand() * 0.5);
      const base = v3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.9 + 0.4);
      const target = targets[i % 3];
      const v = new Vine(base, target, 2.4 + rand() * 1.8, 0.06 + rand() * 0.05, i * 3.7, vineMat);
      vines.push(v);
      root.add(v.mesh);
    }
    // Leafy clumps on the floor.
    const leaf = new THREE.MeshStandardMaterial({ color: "#2a4a1c", roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 160; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * R * 0.95;
      root.add(mesh(new THREE.ConeGeometry(0.12 + rand() * 0.16, 0.2 + rand() * 0.3, 5), leaf, [Math.cos(a) * r, 0.1, Math.sin(a) * r], [rand() * 0.6, rand() * 3, rand() * 0.6]));
    }

    let gripTarget = 0;
    let retreatTarget = 0;
    let bright = 0;
    let brightTarget = 0;
    const tmp = new THREE.Vector3();

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(3.6, 3.6, 4.4), look: v3(-0.4, 0.6, -0.6) },
      bounds: new THREE.Box3(v3(-5.6, 0.25, -5.6), v3(5.6, 6.6, 5.6)),
      background: new THREE.Color("#030403"),
      fog: new THREE.FogExp2("#040604", 0.06),
      environmentIntensity: 0.12,
      music: "tension",
      update(dt, t) {
        passageTorch.flame.update(dt, t);
        bright = damp(bright, brightTarget, 2, dt);
        blue.intensity = bright * (34 + noise1(t * 8) * 6);
        ambient.intensity = 0.35 + bright * 0.5;
        for (const v of vines) {
          v.grip = damp(v.grip, gripTarget, 1.6 + (v.seed % 1), dt);
          v.retreat = damp(v.retreat, retreatTarget, 1.2, dt);
          const a = ctx.actor(v.target);
          const at = a ? tmp.copy(a.position) : null;
          v.update(t, at, a ? a.height * 0.62 : 1);
        }
        if (bright > 0.3 && Math.random() < dt * 30) {
          ctx.particles.glow.emit({ count: 2, at: v3(0, 0.15, 0.3), spread: 0.7, velocity: v3(0, 1.2, 0), jitter: 0.4, life: [0.4, 0.8], size: [0.2, 0.4], color: hdr("#5aa8ff", 3.5), colorEnd: hdr("#1a3aa0", 0.4), grow: 0.3 });
        }
      },
      setProp(prop, state, instant) {
        if (prop === "vines") {
          gripTarget = state === "grip" ? 1 : 0;
          retreatTarget = state === "retreat" ? 1 : 0;
          if (instant) for (const v of vines) [v.grip, v.retreat] = [gripTarget, retreatTarget];
        }
        if (prop === "light") {
          brightTarget = state === "bright" ? 1 : 0;
          if (instant) bright = brightTarget;
        }
      },
    };
  },
};
