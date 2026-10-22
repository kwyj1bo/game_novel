import * as THREE from "three";
import type { Particles } from "../engine/fx/Particles";
import { flame } from "../engine/fx/Particles";
import { noise1, rng } from "../engine/core/math";
import { mesh, pillar, stoneMaterial, woodMaterial } from "./kit";

// Procedural props for generic sceneries. Each builder returns a group
// standing on y = 0 facing +z, plus an optional per-frame update (flames).

export interface Prop {
  group: THREE.Group;
  // Footprint radius, used to keep props apart and off the stage.
  radius: number;
  // Props that hug walls indoors (shelves, beds) rather than stand in the room.
  wall?: boolean;
  update?: (dt: number, t: number) => void;
  light?: THREE.PointLight;
}

type Ctx = { particles: Particles; night: boolean; rand: () => number };

const std = (color: string, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  children.forEach((c) => g.add(c));
  return g;
}

export const PROP_BUILDERS: Record<string, (ctx: Ctx) => Prop> = {
  tree: ({ rand }) => {
    const h = 3 + rand() * 2.5;
    const g = group(mesh(new THREE.CylinderGeometry(0.16, 0.26, h * 0.55, 8), std("#5a4128", 1), [0, h * 0.27, 0]));
    const leaf = std(["#3f6a2a", "#4d7a30", "#355a24"][Math.floor(rand() * 3)], 0.9);
    for (let i = 0; i < 4; i++) {
      const r = 0.9 + rand() * 0.8;
      g.add(mesh(new THREE.IcosahedronGeometry(r, 1), leaf, [(rand() - 0.5) * 1.2, h * 0.6 + rand() * h * 0.35, (rand() - 0.5) * 1.2]));
    }
    return { group: g, radius: 1.4 };
  },
  pine: ({ rand }) => {
    const h = 4 + rand() * 3;
    const g = group(mesh(new THREE.CylinderGeometry(0.12, 0.2, h * 0.4, 7), std("#4a3420", 1), [0, h * 0.2, 0]));
    const leaf = std(["#24452a", "#2c5032", "#1f3c26"][Math.floor(rand() * 3)], 0.9);
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.ConeGeometry(1.4 - i * 0.35, h * 0.38, 9), leaf, [0, h * (0.35 + i * 0.2), 0]));
    return { group: g, radius: 1.2 };
  },
  bush: ({ rand }) => {
    const g = new THREE.Group();
    const leaf = std("#3d6228", 0.9);
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.4 + rand() * 0.3, 1), leaf, [(rand() - 0.5) * 0.8, 0.35, (rand() - 0.5) * 0.8]));
    return { group: g, radius: 0.8 };
  },
  rock: ({ rand }) => {
    const s = 0.4 + rand() * 1.1;
    const m = mesh(new THREE.DodecahedronGeometry(s, 0), stoneMaterial("#6a665e", "rock", [0.5, 0.5]), [0, s * 0.45, 0], [rand(), rand() * 3, rand()]);
    m.scale.set(1, 0.65, 1);
    return { group: group(m), radius: s };
  },
  house: ({ rand, night }) => {
    const w = 4 + rand() * 2;
    const d = 4 + rand() * 1.5;
    const h = 3 + rand() * 1.5;
    const wall = std(["#c8b89a", "#b8a07a", "#d8cfc0", "#a89070"][Math.floor(rand() * 4)], 0.95);
    const roof = std(["#6a3a2a", "#4a3a3a", "#7a5a3a"][Math.floor(rand() * 3)], 0.9);
    const g = group(mesh(new THREE.BoxGeometry(w, h, d), wall, [0, h / 2, 0]));
    const r = mesh(new THREE.CylinderGeometry(d * 0.72, d * 0.72, w + 0.4, 3, 1), roof, [0, h + d * 0.3, 0], [0, 0, Math.PI / 2]);
    r.scale.set(1, 1, 0.75);
    g.add(r);
    g.add(mesh(new THREE.BoxGeometry(0.9, 1.9, 0.06), woodMaterial("#4a2e18"), [0, 0.95, d / 2 + 0.03]));
    const glass = new THREE.MeshStandardMaterial({ color: night ? "#ffcf80" : "#8aa0b8", emissive: new THREE.Color(night ? "#ff9a3a" : "#000000"), emissiveIntensity: night ? 2.5 : 0, roughness: 0.2 });
    for (const x of [-w * 0.3, w * 0.3]) g.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.05), glass, [x, h * 0.6, d / 2 + 0.03]));
    return { group: g, radius: Math.max(w, d) * 0.65 };
  },
  fence: () => {
    const wood = std("#6a4a2a", 1);
    const g = new THREE.Group();
    for (const x of [-1, 0, 1]) g.add(mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), wood, [x, 0.55, 0]));
    for (const y of [0.4, 0.85]) g.add(mesh(new THREE.BoxGeometry(2.1, 0.08, 0.05), wood, [0, y, 0]));
    return { group: g, radius: 1.1 };
  },
  lamp_post: ({ night }) => {
    const iron = std("#222", 0.5, { metalness: 0.7 });
    const g = group(mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.2, 8), iron, [0, 1.6, 0]), mesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), new THREE.MeshStandardMaterial({ color: "#ffe0a0", emissive: new THREE.Color("#ffb050"), emissiveIntensity: night ? 3 : 0.2 }), [0, 3.35, 0]));
    const light = new THREE.PointLight("#ffb860", night ? 8 : 0, 10, 1.6);
    light.position.set(0, 3.3, 0);
    g.add(light);
    return { group: g, radius: 0.4, light };
  },
  table: () => {
    const wood = woodMaterial("#5a3a20");
    const g = group(mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), wood, [0, 0.78, 0]));
    for (const x of [-0.7, 0.7]) for (const z of [-0.35, 0.35]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.78, 0.08), wood, [x, 0.39, z]));
    return { group: g, radius: 1.0 };
  },
  chair: () => {
    const wood = woodMaterial("#5a3a20");
    const g = group(mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), wood, [0, 0.45, 0]), mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), wood, [0, 0.72, -0.2]));
    for (const x of [-0.18, 0.18]) for (const z of [-0.18, 0.18]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.45, 0.05), wood, [x, 0.22, z]));
    return { group: g, radius: 0.4 };
  },
  bed: () => {
    const g = group(
      mesh(new THREE.BoxGeometry(1.4, 0.45, 2.1), woodMaterial("#4a2e18"), [0, 0.22, 0]),
      mesh(new THREE.BoxGeometry(1.3, 0.18, 2.0), std("#d8d0c0", 0.9), [0, 0.53, 0]),
      mesh(new THREE.BoxGeometry(1.32, 0.12, 1.2), std("#7a2a2a", 0.9), [0, 0.6, 0.35]),
      mesh(new THREE.BoxGeometry(1.4, 1.0, 0.1), woodMaterial("#4a2e18"), [0, 0.5, -1.05]),
    );
    return { group: g, radius: 1.2, wall: true };
  },
  bookshelf: ({ rand }) => {
    const g = group(mesh(new THREE.BoxGeometry(1.6, 2.2, 0.4), woodMaterial("#4a2e18"), [0, 1.1, 0]));
    const colors = ["#7a2a2a", "#2a4a7a", "#3a5a2a", "#7a6a2a", "#4a2a5a", "#2a2a2a"];
    for (let shelf = 0; shelf < 4; shelf++) {
      let x = -0.7;
      while (x < 0.65) {
        const w = 0.05 + rand() * 0.06;
        const h = 0.3 + rand() * 0.12;
        g.add(mesh(new THREE.BoxGeometry(w, h, 0.28), std(colors[Math.floor(rand() * colors.length)], 0.8), [x + w / 2, 0.2 + shelf * 0.52 + h / 2, 0.05]));
        x += w + 0.01;
      }
    }
    return { group: g, radius: 0.9, wall: true };
  },
  barrel: () => {
    const prof = [0, 0.32, 0.38, 0.4, 0.38, 0.32, 0].map((r, i) => new THREE.Vector2(r || 0.001, i * 0.16));
    const g = group(mesh(new THREE.LatheGeometry(prof, 14), woodMaterial("#6a4428", [2, 1])));
    for (const y of [0.18, 0.78]) g.add(mesh(new THREE.TorusGeometry(0.37, 0.015, 6, 20), std("#333", 0.5, { metalness: 0.6 }), [0, y, 0], [Math.PI / 2, 0, 0]));
    return { group: g, radius: 0.45 };
  },
  crate: ({ rand }) => {
    const s = 0.6 + rand() * 0.3;
    return { group: group(mesh(new THREE.BoxGeometry(s, s, s), woodMaterial("#8a6a3a", [1, 1]), [0, s / 2, 0], [0, rand(), 0])), radius: s * 0.8 };
  },
  fireplace: ({ particles }) => {
    const stone = stoneMaterial("#6a6258", "hearth", [1, 1]);
    const g = group(
      mesh(new THREE.BoxGeometry(2.0, 1.5, 0.6), stone, [0, 0.75, -0.1]),
      mesh(new THREE.BoxGeometry(1.1, 0.9, 0.2), new THREE.MeshBasicMaterial({ color: "#0a0604" }), [0, 0.5, 0.15]),
      mesh(new THREE.BoxGeometry(2.3, 0.15, 0.75), stone, [0, 1.55, -0.05]),
    );
    const light = new THREE.PointLight("#ff8a3a", 10, 9, 1.6);
    light.position.set(0, 0.6, 0.6);
    g.add(light);
    const at = new THREE.Vector3();
    return {
      group: g,
      radius: 1.2,
      wall: true,
      light,
      update(dt, t) {
        g.localToWorld(at.set(0, 0.25, 0.2));
        flame(particles, at, 1.6, "#ff8a2a", dt);
        light.intensity = 10 * (0.85 + noise1(t * 6) * 0.15);
      },
    };
  },
  candle: ({ particles }) => {
    const g = group(
      mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.25, 10), new THREE.MeshStandardMaterial({ color: "#efe6d0", emissive: new THREE.Color("#3a2a10"), emissiveIntensity: 0.4 }), [0, 1.05, 0]),
      mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.92, 8), std("#3a3028", 0.6, { metalness: 0.5 }), [0, 0.46, 0]),
    );
    const light = new THREE.PointLight("#ffb050", 2.5, 5, 1.8);
    light.position.set(0, 1.3, 0);
    g.add(light);
    const at = new THREE.Vector3();
    return {
      group: g,
      radius: 0.3,
      light,
      update(dt, t) {
        g.localToWorld(at.set(0, 1.2, 0));
        if (Math.random() < 0.6) flame(particles, at, 0.35, "#ffb347", dt);
        light.intensity = 2.5 * (0.85 + noise1(t * 9, at.x) * 0.15);
      },
    };
  },
  rug: ({ rand }) => {
    const c = ["#6a2a2a", "#2a3a5a", "#5a4a2a"][Math.floor(rand() * 3)];
    return { group: group(mesh(new THREE.PlaneGeometry(2.6, 1.8), std(c, 1), [0, 0.01, 0], [-Math.PI / 2, 0, 0], { cast: false })), radius: 0.2 };
  },
  pillar: () => ({ group: pillar(6, 0.35, stoneMaterial("#7a7262", "gpillar", [1, 2])), radius: 0.6 }),
  well: () => {
    const stone = stoneMaterial("#6a665e", "well", [2, 0.5]);
    const g = group(mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.8, 16, 1, true), stone, [0, 0.4, 0]), mesh(new THREE.CircleGeometry(0.78, 16), new THREE.MeshBasicMaterial({ color: "#050505" }), [0, 0.5, 0], [-Math.PI / 2, 0, 0]));
    for (const x of [-0.75, 0.75]) g.add(mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), woodMaterial("#5a3a20"), [x, 1.2, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.7, 4, 1), std("#5a3a2a"), [0, 2.2, 0], [0, 0, Math.PI / 2]));
    return { group: g, radius: 1.0 };
  },
  boat: () => {
    // Half a cylinder, open side up, as a rowing boat's hull.
    const hull = new THREE.CylinderGeometry(0.8, 0.8, 3.6, 12, 1, true, Math.PI / 2, Math.PI);
    const wood = woodMaterial("#6a4428", [3, 1]);
    wood.side = THREE.DoubleSide;
    return { group: group(mesh(hull, wood, [0, 0.6, 0], [Math.PI / 2, 0, Math.PI])), radius: 2.0 };
  },
  stall: ({ rand }) => {
    const wood = woodMaterial("#5a3a20");
    const cloth = std(["#8a2a2a", "#2a5a8a", "#8a7a2a"][Math.floor(rand() * 3)], 0.9, { side: THREE.DoubleSide });
    const g = group(mesh(new THREE.BoxGeometry(2.2, 0.9, 0.9), wood, [0, 0.45, 0]));
    for (const x of [-1.05, 1.05]) for (const z of [-0.4, 0.4]) g.add(mesh(new THREE.BoxGeometry(0.07, 2.2, 0.07), wood, [x, 1.1, z]));
    g.add(mesh(new THREE.PlaneGeometry(2.4, 1.2), cloth, [0, 2.25, 0], [-Math.PI / 2 + 0.25, 0, 0]));
    return { group: g, radius: 1.3 };
  },
  pew: () => {
    const wood = woodMaterial("#4a2e18");
    return { group: group(mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), wood, [0, 0.45, 0]), mesh(new THREE.BoxGeometry(2.4, 0.6, 0.06), wood, [0, 0.75, -0.24]), mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), wood, [-1.15, 0.22, 0]), mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), wood, [1.15, 0.22, 0])), radius: 1.3 };
  },
  desk: () => {
    const wood = woodMaterial("#6a4428");
    const g = group(mesh(new THREE.BoxGeometry(1.1, 0.06, 0.6), wood, [0, 0.74, 0]), mesh(new THREE.BoxGeometry(1.1, 0.72, 0.05), wood, [0, 0.37, -0.28]));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.04, 0.22), std("#d8cfb0"), [0.1, 0.79, 0.05]));
    return { group: g, radius: 0.7 };
  },
  mast: () => {
    const g = group(mesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 10), woodMaterial("#6a4428", [1, 4]), [0, 4.5, 0]));
    g.add(mesh(new THREE.PlaneGeometry(3.6, 4), std("#e8e0cc", 0.9, { side: THREE.DoubleSide }), [0, 5.4, 0.25]));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 8), woodMaterial("#6a4428"), [0, 7.4, 0.25], [0, 0, Math.PI / 2]));
    return { group: g, radius: 0.5 };
  },
  cart: () => {
    const wood = woodMaterial("#6a4a2a");
    const g = group(mesh(new THREE.BoxGeometry(1.4, 0.5, 2.2), wood, [0, 0.8, 0]));
    for (const x of [-0.8, 0.8]) g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 14), wood, [x, 0.5, 0.3], [0, 0, Math.PI / 2]));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 1.6), wood, [0.3, 0.6, 1.8]));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 1.6), wood, [-0.3, 0.6, 1.8]));
    return { group: g, radius: 1.4 };
  },
};

export function buildProp(kind: string, particles: Particles, night: boolean, seed: number): Prop {
  return PROP_BUILDERS[kind]({ particles, night, rand: rng(seed) });
}
