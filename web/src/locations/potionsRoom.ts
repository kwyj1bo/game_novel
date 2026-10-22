import * as THREE from "three";
import { damp, noise1 } from "../engine/core/math";
import { hdr } from "../engine/fx/Particles";
import type { LocationDef } from "../engine/world/Location";
import { flagstoneMaterial, mesh, room, stoneMaterial, autoMarks, v3, woodMaterial } from "./kit";

const MARKS = {
  entry: v3(0, 0, 3.9),
  harry_table: v3(0.55, 0, 1.25),
  hermione_table: v3(-0.65, 0, 1.15),
  table: v3(0, 0, 0.2),
  bottles: v3(0, 1.0, 0.2),
  front_fire: v3(0, 0, -4.4),
  beyond: v3(0, 0, -6.6),
  back_fire: v3(0, 0, 4.6),
  back_beyond: v3(0, 0, 6.4),
  ...autoMarks(v3(0, 0, 1.6), v3(2.2, 2.4, 3.6), v3(0, 0, 3.9), 1.0),
};

// Seven bottles in a row; three matter to the story.
const BOTTLES: { id?: string; profile: number[][]; color: string; x: number }[] = [
  { profile: [[0, 0], [0.07, 0], [0.08, 0.18], [0.03, 0.24], [0.03, 0.3]], color: "#5a7a3a", x: -0.6 },
  { id: "poison", profile: [[0, 0], [0.05, 0], [0.05, 0.36], [0.02, 0.42], [0.02, 0.48]], color: "#3f8a2a", x: -0.4 },
  { profile: [[0, 0], [0.09, 0], [0.1, 0.12], [0.04, 0.2], [0.03, 0.26]], color: "#7a2a2a", x: -0.2 },
  { id: "tiny", profile: [[0, 0], [0.03, 0], [0.035, 0.06], [0.012, 0.09], [0.012, 0.11]], color: "#20202a", x: 0.0 },
  { profile: [[0, 0], [0.06, 0], [0.06, 0.25], [0.025, 0.3], [0.025, 0.36]], color: "#6a5a2a", x: 0.18 },
  { profile: [[0, 0], [0.08, 0], [0.09, 0.08], [0.06, 0.2], [0.03, 0.24], [0.03, 0.3]], color: "#2a4a7a", x: 0.38 },
  { id: "round", profile: [[0, 0], [0.04, 0.0], [0.11, 0.08], [0.11, 0.14], [0.04, 0.22], [0.025, 0.26], [0.025, 0.32]], color: "#7a3a9a", x: 0.62 },
];

export const potionsRoom: LocationDef = {
  id: "potions_room",
  title: "The Riddle of the Potions",
  info: {
    marks: Object.keys(MARKS),
    props: {
      back_fire: ["off", "on"],
      front_fire: ["off", "on"],
      tiny: ["table", "harry", "gone"],
      round: ["table", "hermione", "gone"],
      poison: ["table", "harry", "gone"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const W = 6;
    const H = 5;
    const D = 10;
    const wall = stoneMaterial("#575046", "potions", [2.5, 2]);
    root.add(room(W, H, D, wall, flagstoneMaterial("#4a443c", [2, 4]), stoneMaterial("#2e2a26", "potceil", [2, 3])));
    // Short corridors beyond both doorways so the fires have depth behind them.
    for (const z of [-1, 1]) {
      const c = room(2.2, 3, 3, wall, flagstoneMaterial("#3e3a33", [1, 1.5]));
      c.position.set(0, 0, z * 6.4);
      root.add(c);
      // Hide the corridor's inner end wall facing the room.
      c.children[z < 0 ? 2 : 1].visible = false;
    }
    // Cut the doorways visually with dark frames.
    const frame = stoneMaterial("#6a6256", "potframe", [1, 1]);
    for (const z of [-4.95, 4.95]) {
      root.add(mesh(new THREE.BoxGeometry(1.95, 5, 0.12), wall, [-2.05, 2.5, z]));
      root.add(mesh(new THREE.BoxGeometry(1.95, 5, 0.12), wall, [2.05, 2.5, z]));
      root.add(mesh(new THREE.BoxGeometry(2.2, 2, 0.12), wall, [0, 4, z]));
      root.add(mesh(new THREE.BoxGeometry(0.2, 3.1, 0.3), frame, [-1.15, 1.5, z]));
      root.add(mesh(new THREE.BoxGeometry(0.2, 3.1, 0.3), frame, [1.15, 1.5, z]));
    }
    // Hide the main room's end walls where the doorways are (replaced by the pieces above).
    (root.children[0] as THREE.Group).children[2].visible = false;
    (root.children[0] as THREE.Group).children[3].visible = false;

    // Table, scroll, bottles.
    const table = new THREE.Group();
    table.position.copy(MARKS.table);
    const wood = woodMaterial("#4a301a", [1, 1]);
    table.add(mesh(new THREE.BoxGeometry(1.8, 0.08, 0.7), wood, [0, 0.86, 0]));
    for (const x of [-0.8, 0.8]) for (const z of [-0.28, 0.28]) table.add(mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08), wood, [x, 0.43, z]));
    table.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), new THREE.MeshStandardMaterial({ color: "#d9c9a0", roughness: 0.9 }), [0, 0.92, 0.22], [0, 0, Math.PI / 2]));
    root.add(table);
    const bottles: Record<string, THREE.Group> = {};
    for (const b of BOTTLES) {
      const g = new THREE.Group();
      const glass = new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.08, transmission: 0.6, thickness: 0.05, transparent: true, opacity: 0.9, emissive: new THREE.Color(b.color).multiplyScalar(0.15) });
      g.add(mesh(new THREE.LatheGeometry(b.profile.map(([x, y]) => new THREE.Vector2(x, y)), 18), glass));
      const top = b.profile[b.profile.length - 1][1];
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.04, 8), new THREE.MeshStandardMaterial({ color: "#6a4a2a" }), [0, top + 0.02, 0]));
      g.position.set(b.x, 0.9, -0.05);
      table.add(g);
      if (b.id) bottles[b.id] = g;
    }
    const homes = Object.fromEntries(Object.entries(bottles).map(([k, g]) => [k, g.position.clone()]));

    root.add(new THREE.HemisphereLight("#403850", "#140f0a", 0.4));
    const candle = new THREE.PointLight("#ffc27a", 6, 6, 1.6);
    candle.position.set(0, 1.6, 0.4);
    candle.castShadow = true;
    candle.shadow.mapSize.set(1024, 1024);
    candle.shadow.bias = -0.003;
    root.add(candle);
    const purple = new THREE.PointLight("#b45cff", 0, 9, 1.4);
    purple.position.set(0, 1.4, 4.4);
    const dark = new THREE.PointLight("#5a2a8a", 0, 7, 1.6);
    dark.position.set(0, 1.4, -4.2);
    root.add(purple, dark);

    let back = 0;
    let backT = 0;
    let front = 0;
    let frontT = 0;
    const emitWall = (z: number, amount: number, black: boolean, dt: number) => {
      if (amount < 0.05) return;
      const n = Math.round(90 * dt * amount * 2) + 1;
      for (let i = 0; i < n; i++) {
        const at = v3((Math.random() - 0.5) * 2.0, 0.1, z + (Math.random() - 0.5) * 0.3);
        if (black) {
          ctx.particles.soft.emit({ count: 2, at, velocity: v3(0, 1.3, 0), jitter: 0.35, life: [0.7, 1.4], size: [0.7, 1.2], color: new THREE.Color("#120a1c"), colorEnd: new THREE.Color("#000000"), grow: 0.5, alpha: 0.75 * amount });
          if (Math.random() < 0.3) ctx.particles.glow.emit({ count: 1, at, velocity: v3(0, 1.4, 0), jitter: 0.3, life: [0.3, 0.6], size: [0.1, 0.2], color: hdr("#6a2aaa", 2), grow: 0.3 });
        } else {
          ctx.particles.glow.emit({ count: 1, at, velocity: v3(0, 1.8, 0), jitter: 0.35, life: [0.4, 0.9], size: [0.25, 0.45], color: hdr("#c26aff", 3.2), colorEnd: hdr("#4a1080", 0.4), grow: 0.3 });
        }
      }
    };

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(2.2, 2.4, 3.6), look: v3(-0.3, 1.0, -1.5) },
      bounds: new THREE.Box3(v3(-2.7, 0.3, -7.6), v3(2.7, 4.6, 7.6)),
      background: new THREE.Color("#030203"),
      fog: new THREE.FogExp2("#050307", 0.05),
      environmentIntensity: 0.4,
      music: "mystery",
      update(dt, t) {
        back = damp(back, backT, 3, dt);
        front = damp(front, frontT, 3, dt);
        purple.intensity = back * (14 + noise1(t * 9) * 3);
        dark.intensity = front * (6 + noise1(t * 7, 3) * 2);
        candle.intensity = 6 + noise1(t * 6, 5) * 0.8;
        emitWall(4.7, back, false, dt);
        emitWall(-4.7, front, true, dt);
      },
      setProp(prop, state, instant) {
        if (prop === "back_fire" || prop === "front_fire") {
          const on = state === "on" ? 1 : 0;
          if (prop === "back_fire") backT = on;
          else frontT = on;
          if (instant) [back, front] = [backT, frontT];
          else if (on) ctx.audio.sfx("fire");
        }
        const bottle = bottles[prop];
        if (bottle) {
          const holder = state === "harry" ? ctx.actor("harry") : state === "hermione" ? ctx.actor("hermione") : undefined;
          if (holder) {
            holder.socket("hand_r").add(bottle);
            bottle.position.set(0, -0.02, 0.05);
            bottle.rotation.set(0, 0, 0);
          } else {
            table.add(bottle);
            bottle.position.copy(homes[prop]);
            bottle.rotation.set(0, 0, 0);
          }
          bottle.visible = state !== "gone";
        }
      },
      dispose() {
        for (const b of Object.values(bottles)) b.removeFromParent();
      },
    };
  },
};
