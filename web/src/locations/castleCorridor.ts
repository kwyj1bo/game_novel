import * as THREE from "three";
import { damp } from "../engine/core/math";
import { hdr } from "../engine/fx/Particles";
import type { LocationDef } from "../engine/world/Location";
import { dust, flagstoneMaterial, mesh, pillar, room, stoneMaterial, torch, v3, woodMaterial } from "./kit";

const MARKS = {
  start_harry: v3(0.5, 0, 9.5),
  start_ron: v3(-0.4, 0, 10.2),
  hide_harry: v3(1.5, 0, 3.0),
  hide_ron: v3(1.55, 0, 4.0),
  troll_enter: v3(0, 0, -11.5),
  troll_door: v3(-1.3, 0, -6),
  bathroom_door: v3(-2.4, 0, -6),
  lock_harry: v3(-1.5, 0, -4.9),
  lock_ron: v3(-1.0, 0, -4.0),
  teachers: v3(0, 0, 11.5),
};

export const castleCorridor: LocationDef = {
  id: "castle_corridor",
  title: "A Castle Corridor",
  info: {
    marks: Object.keys(MARKS),
    props: { bathroom_door: ["open", "closed", "locked"] },
  },
  build(ctx) {
    const root = new THREE.Group();
    const W = 5.4;
    const H = 6;
    const D = 26;
    root.add(room(W, H, D, stoneMaterial("#6a6458", "corr", [9, 2.2]), flagstoneMaterial("#4e4a42", [2, 9]), stoneMaterial("#34302a", "corrceil", [2, 9])));
    const stone = stoneMaterial("#7a7262", "corrpillar", [1, 2]);
    // Arched windows on the right wall let in moonlight.
    const glass = new THREE.MeshBasicMaterial({ color: hdr("#8fa8e0", 1.2) });
    const torches: ReturnType<typeof torch>[] = [];
    for (const z of [8, 2, -4, -10]) {
      root.add(mesh(new THREE.PlaneGeometry(1.1, 2.2), glass, [2.69, 3.2, z], [0, -Math.PI / 2, 0], { cast: false }));
      root.add(mesh(new THREE.CircleGeometry(0.55, 20, 0, Math.PI), glass, [2.69, 4.3, z], [0, -Math.PI / 2, 0], { cast: false }));
      const p = pillar(H, 0.25, stone);
      p.position.set(2.45, 0, z + 1.6);
      root.add(p);
      const t = torch(ctx.particles, v3(-2.65, 2.5, z + 1.5), Math.PI / 2);
      torches.push(t);
      root.add(t.group);
    }
    // A statue on a plinth: the boys hide behind it.
    root.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), stone, [1.9, 0.45, 3.5]));
    root.add(mesh(new THREE.CapsuleGeometry(0.3, 1.2, 6, 12), stone, [1.9, 1.75, 3.5]));
    root.add(mesh(new THREE.SphereGeometry(0.22, 12, 10), stone, [1.9, 2.75, 3.5]));

    root.add(new THREE.HemisphereLight("#3a4466", "#120e0a", 0.5));
    const moon = new THREE.DirectionalLight("#9ab0e8", 1.6);
    moon.position.set(8, 7, 2);
    moon.target.position.set(-1, 0, 0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -14, right: 14, top: 6, bottom: -6, near: 1, far: 30 });
    moon.shadow.bias = -0.0005;
    root.add(moon, moon.target);

    // Bathroom door on the left wall, with a key in the lock.
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-2.65, 0, -5.3);
    doorPivot.add(mesh(new THREE.BoxGeometry(0.1, 2.5, 1.4), woodMaterial("#4a2e18", [1, 1]), [0, 1.25, -0.7]));
    const brass = new THREE.MeshStandardMaterial({ color: "#b08a3a", metalness: 0.9, roughness: 0.3 });
    doorPivot.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), brass, [0.06, 1.1, -1.2]));
    const key = mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12), brass, [0.14, 1.1, -1.2], [0, Math.PI / 2, 0]);
    doorPivot.add(key);
    root.add(doorPivot);
    root.add(mesh(new THREE.PlaneGeometry(1.4, 2.5), new THREE.MeshBasicMaterial({ color: "#070605" }), [-2.69, 1.25, -6], [0, Math.PI / 2, 0], { cast: false }));
    root.add(mesh(new THREE.BoxGeometry(0.2, 0.3, 1.8), stone, [-2.6, 2.65, -6]));

    const motes = dust(ctx.particles, v3(0, 3, 0), v3(5, 5, 24), "#b8c8ff", 8);
    let open = 1;
    let openT = 1;
    let keyTurn = 0;
    let keyT = 0;
    return {
      root,
      marks: MARKS,
      wide: { pos: v3(1.6, 2.2, 11.6), look: v3(-0.4, 1.4, -4) },
      bounds: new THREE.Box3(v3(-2.4, 0.3, -12.6), v3(2.4, 5.6, 12.6)),
      background: new THREE.Color("#050608"),
      fog: new THREE.FogExp2("#06070b", 0.045),
      environmentIntensity: 0.25,
      music: "tension",
      update(dt, t) {
        torches.forEach((tr) => tr.flame.update(dt, t));
        motes(dt);
        open = damp(open, openT, 4, dt);
        doorPivot.rotation.y = open * 1.5;
        keyTurn = damp(keyTurn, keyT, 8, dt);
        key.rotation.x = keyTurn * Math.PI / 2;
      },
      setProp(_prop, state, instant) {
        openT = state === "open" ? 1 : 0;
        keyT = state === "locked" ? 1 : 0;
        if (instant) [open, keyTurn] = [openT, keyT];
        else ctx.audio.sfx(state === "open" ? "creak" : "thud");
      },
    };
  },
};
