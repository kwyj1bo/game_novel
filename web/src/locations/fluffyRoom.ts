import * as THREE from "three";
import { damp } from "../engine/core/math";
import { hdr } from "../engine/fx/Particles";
import type { LocationDef } from "../engine/world/Location";
import { dust, flagstoneMaterial, mesh, pillar, room, stoneMaterial, torch, v3, woodMaterial } from "./kit";

const MARKS = {
  door: v3(5.3, 0, 5),
  harry_in: v3(3.4, 0, 5.1),
  ron_in: v3(4.1, 0, 6.1),
  hermione_in: v3(3.9, 0, 4.0),
  harry_mid: v3(0.9, 0, 1.6),
  ron_mid: v3(2.0, 0, 2.5),
  hermione_mid: v3(0.0, 0, 2.7),
  harry_trap: v3(-1.5, 0, -0.8),
  ron_trap: v3(-3.3, 0, -0.7),
  hermione_trap: v3(-2.7, 0, 0.4),
  trapdoor: v3(-2.4, 0, -2.0),
  fluffy: v3(0.8, 0, -5.2),
  fluffy_strike: v3(-0.6, 0, -1.6),
  harp: v3(3.7, 0, -3.2),
  center: v3(0, 0, 0.5),
};

export const fluffyRoom: LocationDef = {
  id: "fluffy_room",
  title: "The Forbidden Corridor",
  info: {
    marks: Object.keys(MARKS),
    props: {
      trapdoor: ["closed", "open"],
      harp: ["playing", "silent"],
      door: ["closed", "open"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const W = 12;
    const H = 7;
    const D = 18;
    const wall = stoneMaterial("#6c665c", "corridor", [4, 2.5]);
    const floor = flagstoneMaterial("#57524a", [4, 6]);
    const ceil = stoneMaterial("#3a3632", "ceil", [3, 4]);
    root.add(room(W, H, D, wall, floor, ceil));

    // Ceiling beams and pillars give the room depth.
    const beamWood = woodMaterial("#3b2717", [1, 4]);
    for (const z of [-6, -2, 2, 6]) root.add(mesh(new THREE.BoxGeometry(W, 0.4, 0.45), beamWood, [0, H - 0.2, z]));
    const pillarStone = stoneMaterial("#77705f", "pillar", [1, 2]);
    for (const x of [-5.4, 5.4]) for (const z of [-6, -2, 2, 6]) {
      const p = pillar(H, 0.32, pillarStone);
      p.position.set(x, 0, z);
      root.add(p);
    }

    // Lighting: low ambient, warm torches, a cold moonbeam from a high window.
    root.add(new THREE.HemisphereLight("#3c4060", "#1a120a", 0.55));
    const torches = [
      torch(ctx.particles, v3(-5.85, 2.4, -4), Math.PI / 2),
      torch(ctx.particles, v3(-5.85, 2.4, 0), Math.PI / 2),
      torch(ctx.particles, v3(5.85, 2.4, 0), -Math.PI / 2),
      torch(ctx.particles, v3(5.85, 2.4, -6.5), -Math.PI / 2),
      torch(ctx.particles, v3(-2.5, 2.6, -8.85), 0),
      torch(ctx.particles, v3(2.5, 2.6, -8.85), 0),
    ];
    for (const t of torches) root.add(t.group);

    const moon = new THREE.SpotLight("#8fa6d8", 60, 30, 0.42, 0.6, 1.6);
    moon.position.set(-5.5, 6.4, 3);
    moon.target.position.set(0.5, 0, -2);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.03;
    root.add(moon, moon.target);
    // High window the moonlight comes through.
    root.add(mesh(new THREE.PlaneGeometry(1.2, 1.8), new THREE.MeshBasicMaterial({ color: hdr("#9fb4e6", 1.6) }), [-5.98, 5.6, 3], [0, Math.PI / 2, 0], { cast: false }));

    // Door on the right wall.
    const doorPivot = new THREE.Group();
    doorPivot.position.set(5.95, 0, 4.2);
    const doorWood = woodMaterial("#4a2e18", [1, 1]);
    doorPivot.add(mesh(new THREE.BoxGeometry(0.1, 2.6, 1.6), doorWood, [0, 1.3, 0.8]));
    doorPivot.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: "#a08030", metalness: 0.8, roughness: 0.3 }), [-0.08, 1.2, 1.4]));
    root.add(doorPivot);
    root.add(mesh(new THREE.BoxGeometry(0.3, 2.9, 0.25), pillarStone, [5.9, 1.45, 4.05]));
    root.add(mesh(new THREE.BoxGeometry(0.3, 2.9, 0.25), pillarStone, [5.9, 1.45, 5.95]));
    root.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 2.2), pillarStone, [5.9, 2.9, 5]));
    // Darkness beyond the door.
    root.add(mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ color: "#050403" }), [5.99, 1.3, 5], [0, -Math.PI / 2, 0], { cast: false }));

    // Trapdoor: stone frame, black pit, hinged wooden lid.
    const td = MARKS.trapdoor;
    root.add(mesh(new THREE.BoxGeometry(1.5, 0.06, 1.5), pillarStone, [td.x, 0.03, td.z]));
    root.add(mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ color: "#000" }), [td.x, 0.065, td.z], [-Math.PI / 2, 0, 0], { cast: false }));
    const lidPivot = new THREE.Group();
    lidPivot.position.set(td.x, 0.07, td.z - 0.6);
    const lid = new THREE.Group();
    lid.add(mesh(new THREE.BoxGeometry(1.2, 0.07, 1.2), woodMaterial("#5a3a1e", [1, 1]), [0, 0.035, 0.6]));
    const iron = new THREE.MeshStandardMaterial({ color: "#2a2826", metalness: 0.8, roughness: 0.4 });
    lid.add(mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16), iron, [0, 0.09, 0.95], [Math.PI / 2, 0, 0]));
    for (const x of [-0.4, 0.4]) lid.add(mesh(new THREE.BoxGeometry(0.08, 0.075, 1.1), iron, [x, 0.04, 0.6]));
    lidPivot.add(lid);
    root.add(lidPivot);

    // Enchanted harp.
    const harp = new THREE.Group();
    harp.position.copy(MARKS.harp);
    harp.rotation.y = -0.6;
    const gold = new THREE.MeshStandardMaterial({ color: "#b8902e", metalness: 0.85, roughness: 0.3 });
    const frameCurve = new THREE.CatmullRomCurve3([v3(0, 0.1, 0), v3(0, 1.6, 0), v3(0.25, 1.9, 0), v3(0.9, 1.5, 0), v3(1.2, 0.9, 0), v3(0.9, 0.25, 0), v3(0, 0.1, 0)]);
    harp.add(mesh(new THREE.TubeGeometry(frameCurve, 80, 0.05, 8, false), gold));
    harp.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.15, 12), gold, [0.3, 0.07, 0]));
    const stringMat = new THREE.MeshBasicMaterial({ color: hdr("#ffe6a0", 1) });
    const strings: THREE.Mesh[] = [];
    for (let i = 0; i < 9; i++) {
      const x = 0.1 + i * 0.1;
      const top = frameCurve.getPoint(0.18 + i * 0.035).y;
      const len = Math.max(0.3, top - 0.25);
      const s = mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 4), stringMat, [x, 0.25 + len / 2, 0], [0, 0, 0], { cast: false });
      strings.push(s);
      harp.add(s);
    }
    root.add(harp);

    // Sparse cobwebs/rubble for texture.
    const rubble = stoneMaterial("#5a5348", "rubble", [0.3, 0.3]);
    for (let i = 0; i < 18; i++) {
      const s = 0.08 + Math.random() * 0.2;
      root.add(mesh(new THREE.DodecahedronGeometry(s, 0), rubble, [-5 + Math.random() * 10, s * 0.5, -8.4 + Math.random() * 1.5], [Math.random(), Math.random(), 0]));
    }

    const motes = dust(ctx.particles, v3(-2, 3.5, 0), v3(6, 5, 10), "#c8d4ff", 10);
    let doorOpen = 0;
    let doorTarget = 0;
    let lidOpen = 0;
    let lidTarget = 0;
    let harpPlaying = false;

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(1.2, 3.5, 8.4), look: v3(-0.4, 1.3, -2.4) },
      bounds: new THREE.Box3(v3(-5.6, 0.25, -8.6), v3(5.6, 6.6, 8.6)),
      background: new THREE.Color("#050608"),
      fog: new THREE.FogExp2("#07080c", 0.035),
      environmentIntensity: 0.2,
      music: "dread",
      update(dt, t) {
        for (const tr of torches) tr.flame.update(dt, t);
        motes(dt);
        doorOpen = damp(doorOpen, doorTarget, 2.5, dt);
        doorPivot.rotation.y = -doorOpen * 1.6;
        lidOpen = damp(lidOpen, lidTarget, 3, dt);
        lidPivot.rotation.x = -lidOpen * 1.95;
        const glow = harpPlaying ? 2.5 + Math.sin(t * 6) * 1 : 0.4;
        stringMat.color.copy(hdr("#ffe6a0", glow));
        strings.forEach((s, i) => (s.scale.x = harpPlaying ? 1 + Math.sin(t * 40 + i * 2) * 0.8 : 1));
        if (harpPlaying && Math.random() < dt * 6) {
          ctx.particles.glow.emit({ count: 1, at: harp.localToWorld(v3(0.5, 0.9, 0)), spread: 0.4, velocity: v3(0, 0.2, 0), jitter: 0.1, life: [1, 2], size: [0.02, 0.05], color: hdr("#ffd27a", 5) });
        }
      },
      setProp(prop, state, instant) {
        if (prop === "door") {
          doorTarget = state === "open" ? 1 : 0;
          if (instant) doorOpen = doorTarget;
          else ctx.audio.sfx("creak");
        }
        if (prop === "trapdoor") {
          lidTarget = state === "open" ? 1 : 0;
          if (instant) lidOpen = lidTarget;
          else ctx.audio.sfx("door");
        }
        if (prop === "harp") {
          harpPlaying = state === "playing";
          ctx.audio.music(harpPlaying ? "harp" : "dread");
        }
      },
    };
  },
};
