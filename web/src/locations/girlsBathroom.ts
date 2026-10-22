import * as THREE from "three";
import { easeInCubic } from "../engine/core/math";
import { hdr } from "../engine/fx/Particles";
import type { LocationDef } from "../engine/world/Location";
import { mesh, room, stoneMaterial, tileMaterial, torch, autoMarks, v3, woodMaterial } from "./kit";

const MARKS = {
  entry: v3(0.6, 0, 5.4),
  harry_in: v3(0.9, 0, 3.4),
  ron_in: v3(-0.1, 0, 3.8),
  hermione_corner: v3(-2.9, 0, -3.6),
  troll_start: v3(0.2, 0, -1.4),
  troll_hermione: v3(-1.6, 0, -2.6),
  troll_turn: v3(-0.4, 0, -1.0),
  ron_side: v3(1.5, 0, 1.8),
  harry_side: v3(-1.8, 0, 1.8),
  harry_hermione: v3(-2.3, 0, -1.6),
  sinks: v3(-3.3, 1.0, -1.5),
  ...autoMarks(v3(0, 0, 1.0), v3(2.2, 2.9, 5.4), v3(0.6, 0, 5.4), 1.5),
};

export const girlsBathroom: LocationDef = {
  id: "girls_bathroom",
  title: "The Girls' Bathroom",
  info: {
    marks: Object.keys(MARKS),
    props: {
      club: ["held", "floating", "dropped"],
      sinks: ["whole", "smashed"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const W = 8;
    const H = 4.6;
    const D = 12;
    root.add(room(W, H, D, tileMaterial("#cfd6cc", [6, 3.5]), tileMaterial("#b9b2a2", [6, 9]), stoneMaterial("#3a3a36", "bathceil", [3, 4])));
    // Dark wainscot band.
    const band = new THREE.MeshStandardMaterial({ color: "#2e4a3a", roughness: 0.4 });
    for (const [w, d, x, z] of [
      [W, 0.06, 0, -D / 2 + 0.03],
      [W, 0.06, 0, D / 2 - 0.03],
      [0.06, D, -W / 2 + 0.03, 0],
      [0.06, D, W / 2 - 0.03, 0],
    ]) {
      root.add(mesh(new THREE.BoxGeometry(w, 0.15, d), band, [x, 1.3, z], [0, 0, 0], { cast: false }));
    }

    // Sinks with mirrors along the left wall.
    const porcelain = new THREE.MeshStandardMaterial({ color: "#f2efe6", roughness: 0.15 });
    const brass = new THREE.MeshStandardMaterial({ color: "#a88a40", metalness: 0.9, roughness: 0.3 });
    const mirrorMat = new THREE.MeshStandardMaterial({ color: "#8a9aa8", metalness: 1, roughness: 0.06 });
    const sinks: { g: THREE.Group; vel: THREE.Vector3; spin: THREE.Vector3; home: THREE.Vector3 }[] = [];
    for (const z of [-3.6, -2.2, -0.8, 0.6]) {
      const g = new THREE.Group();
      g.position.set(-3.65, 0, z);
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.85, 12), porcelain, [0, 0.42, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.55, 0.18, 0.6), porcelain, [0.05, 0.92, 0]));
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), brass, [-0.15, 1.08, 0], [0, 0, 0.6]));
      root.add(g);
      sinks.push({ g, vel: new THREE.Vector3(), spin: new THREE.Vector3(), home: g.position.clone() });
      root.add(mesh(new THREE.BoxGeometry(0.04, 0.9, 0.6), mirrorMat, [-3.97, 1.95, z], [0, 0, 0], { cast: false }));
    }
    // Toilet stalls along the right wall.
    const wood = woodMaterial("#5a3f28", [1, 1]);
    for (let i = 0; i < 4; i++) {
      const z = -4 + i * 1.6;
      root.add(mesh(new THREE.BoxGeometry(1.4, 2.1, 0.05), wood, [3.3, 1.15, z - 0.8]));
      const door = mesh(new THREE.BoxGeometry(0.05, 1.8, 1.4), wood, [2.6, 1.05, z], [0, i % 2 ? 0.3 : 0, 0]);
      root.add(door);
    }
    root.add(mesh(new THREE.BoxGeometry(1.4, 2.1, 0.05), wood, [3.3, 1.15, 2.4]));

    root.add(new THREE.HemisphereLight("#c8d8d0", "#2a2a24", 0.55));
    const lamp = new THREE.SpotLight("#ffe6c0", 70, 16, 0.85, 0.6, 1.4);
    lamp.position.set(0.5, 4.4, 1.5);
    lamp.target.position.set(-0.5, 0, -1.5);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0005;
    root.add(lamp, lamp.target);
    const t1 = torch(ctx.particles, v3(-3.95, 2.6, 3.4), Math.PI / 2);
    root.add(t1.group);
    root.add(mesh(new THREE.PlaneGeometry(1.4, 2.5), new THREE.MeshBasicMaterial({ color: "#060504" }), [0.6, 1.25, 5.98], [0, Math.PI, 0], { cast: false }));

    // The club, once Ron levitates it.
    let clubState = "held";
    let clubT = 0;
    const clubFrom = new THREE.Vector3();
    const clubTo = new THREE.Vector3();
    let smashed = false;

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(2.2, 2.9, 5.4), look: v3(-0.8, 1.2, -1.4) },
      bounds: new THREE.Box3(v3(-3.7, 0.3, -5.7), v3(3.7, 4.3, 5.7)),
      background: new THREE.Color("#0a0b0a"),
      fog: new THREE.FogExp2("#101210", 0.03),
      environmentIntensity: 0.5,
      music: "tension",
      update(dt, t) {
        t1.flame.update(dt, t);
        for (const s of sinks) {
          if (!smashed) continue;
          s.vel.y -= 9.8 * dt;
          s.g.position.addScaledVector(s.vel, dt);
          if (s.g.position.y < 0) {
            s.g.position.y = 0;
            s.vel.multiplyScalar(0.3);
            s.vel.y = 0;
            s.spin.multiplyScalar(0.5);
          }
          s.g.rotation.x += s.spin.x * dt;
          s.g.rotation.z += s.spin.z * dt;
        }
        const troll = ctx.actor("troll");
        const club = troll?.socket("club");
        if (!club || clubState === "held") return;
        clubT = Math.min(1, clubT + dt / (clubState === "floating" ? 2.2 : 0.55));
        if (clubState === "floating") {
          club.position.lerpVectors(clubFrom, clubTo, clubT);
          club.position.y += Math.sin(t * 2) * 0.08 * clubT;
          club.rotation.y += dt * 1.5;
          if (Math.random() < dt * 20) ctx.particles.glow.emit({ count: 1, at: club.position, spread: 0.4, velocity: v3(0, 0.2, 0), jitter: 0.2, life: [0.5, 1], size: [0.03, 0.06], color: hdr("#ffe08a", 5) });
        } else {
          // Drops onto the troll's head, then rolls off to the floor.
          const fall = easeInCubic(clubT);
          club.position.lerpVectors(clubFrom, clubTo, fall);
          club.rotation.z = fall * 1.4;
          if (clubT >= 1 && club.position.y > 0.3) {
            clubFrom.copy(club.position);
            clubTo.set(club.position.x + 0.9, 0.25, club.position.z + 0.5);
            clubT = 0;
          }
        }
      },
      setProp(prop, state, instant) {
        if (prop === "sinks") {
          smashed = state === "smashed";
          for (const [i, s] of sinks.entries()) {
            if (smashed) {
              s.vel.set(1.5 + i * 0.4, 2 + i * 0.5, (i - 1.5) * 0.8);
              s.spin.set(3 + i, 0, 2 - i);
            } else {
              s.g.position.copy(s.home);
              s.g.rotation.set(0, 0, 0);
            }
          }
          if (smashed && !instant) {
            ctx.audio.sfx("crash");
            ctx.audio.sfx("shatter");
            ctx.particles.glow.emit({ count: 60, at: MARKS.sinks, spread: 1.2, velocity: v3(1.5, 1.5, 0), jitter: 2, life: [0.4, 0.9], size: [0.03, 0.06], color: hdr("#cfe8ff", 2), gravity: 6 });
          }
          if (smashed && instant) for (const s of sinks) s.g.position.set(s.home.x + 1.2, 0, s.home.z);
        }
        if (prop === "club") {
          const troll = ctx.actor("troll");
          if (!troll) return;
          const club = troll.socket("club");
          clubState = state;
          clubT = instant ? 1 : 0;
          if (state === "held") return;
          // Detach from the hand into world space.
          club.updateWorldMatrix(true, false);
          root.attach(club);
          clubFrom.copy(club.position);
          const head = troll.headPosition(new THREE.Vector3());
          if (state === "floating") clubTo.copy(head).add(v3(0, 1.4, 0));
          else {
            clubFrom.copy(club.position);
            clubTo.copy(head).add(v3(0, 0.3, 0));
            if (!instant) ctx.audio.sfx("thud");
          }
          if (instant) club.position.copy(state === "floating" ? clubTo : v3(head.x + 0.9, 0.25, head.z + 0.5));
        }
      },
    };
  },
};
