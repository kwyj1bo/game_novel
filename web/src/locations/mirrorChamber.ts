import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { damp, noise1 } from "../engine/core/math";
import { hdr } from "../engine/fx/Particles";
import type { LocationDef } from "../engine/world/Location";
import { flagstoneMaterial, mesh, pillar, stoneMaterial, torch, autoMarks, v3 } from "./kit";

const MARKS = {
  entry: v3(0, 0, 7.2),
  stairs_bottom: v3(0, 0, 4.0),
  harry_mid: v3(-0.3, 0, 1.6),
  quirrell: v3(0.9, 0, -2.6),
  quirrell_mirror: v3(0.6, 0, -3.6),
  harry_mirror: v3(-0.4, 0, -3.3),
  harry_grab: v3(0.3, 0, -1.7),
  mirror: v3(0, 1.7, -5.3),
  mirror_front: v3(0, 0, -4.2),
  ...autoMarks(v3(0, 0, 0.8), v3(3.2, 3.4, 6.2), v3(0, 0, 7.2), 2.0),
};

export const mirrorChamber: LocationDef = {
  id: "mirror_chamber",
  title: "The Last Chamber",
  info: {
    marks: Object.keys(MARKS),
    props: {
      mirror: ["still", "glow"],
      flames: ["off", "on"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const R = 8;
    const H = 9;
    const wall = stoneMaterial("#5a5248", "mirror", [9, 3]);
    wall.side = THREE.BackSide;
    root.add(mesh(new THREE.CylinderGeometry(R, R, H, 48, 1, true), wall, [0, H / 2, 0], [0, 0, 0], { cast: false }));
    root.add(mesh(new THREE.CircleGeometry(R, 48), flagstoneMaterial("#4a443a", [5, 5]), [0, 0, 0], [-Math.PI / 2, 0, 0], { cast: false }));
    const dome = stoneMaterial("#2e2924", "dome", [5, 3]);
    dome.side = THREE.BackSide;
    root.add(mesh(new THREE.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), dome, [0, H, 0], [0, 0, 0], { cast: false }));

    const pillarStone = stoneMaterial("#7a7062", "mpillar", [1, 3]);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      if (Math.abs(Math.sin(a)) < 0.2 && Math.cos(a) > 0) continue;
      const p = pillar(H, 0.42, pillarStone);
      p.position.set(Math.sin(a) * (R - 1), 0, Math.cos(a) * (R - 1));
      root.add(p);
    }
    // Steps down from the entrance.
    for (let i = 0; i < 4; i++) root.add(mesh(new THREE.BoxGeometry(3.4, 0.2 * (4 - i), 0.6), pillarStone, [0, 0.1 * (4 - i), 5.0 + i * 0.6]));

    // The Mirror: arched gold frame on clawed feet with a live reflection.
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(0, 0, -5.4);
    const gold = new THREE.MeshStandardMaterial({ color: "#c8a03a", metalness: 0.95, roughness: 0.28 });
    const outline = new THREE.Shape();
    outline.moveTo(-1.15, 0.3);
    outline.lineTo(1.15, 0.3);
    outline.lineTo(1.15, 2.6);
    outline.absarc(0, 2.6, 1.15, 0, Math.PI, false);
    outline.lineTo(-1.15, 0.3);
    const hole = new THREE.Path();
    hole.moveTo(-0.95, 0.45);
    hole.lineTo(0.95, 0.45);
    hole.lineTo(0.95, 2.6);
    hole.absarc(0, 2.6, 0.95, 0, Math.PI, false);
    hole.lineTo(-0.95, 0.45);
    outline.holes.push(hole);
    const frameGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 32 });
    mirrorGroup.add(mesh(frameGeo, gold, [0, 0, -0.09]));
    for (const x of [-0.95, 0.95]) {
      mirrorGroup.add(mesh(new THREE.SphereGeometry(0.16, 12, 8), gold, [x, 0.14, 0.05], [0, 0, 0]));
      for (const c of [-1, 0, 1]) mirrorGroup.add(mesh(new THREE.ConeGeometry(0.04, 0.16, 5), gold, [x + c * 0.08, 0.05, 0.2], [Math.PI / 2, 0, 0]));
    }
    // Crest on top.
    mirrorGroup.add(mesh(new THREE.OctahedronGeometry(0.22, 0), gold, [0, 3.9, 0.05]));
    const glassShape = new THREE.Shape();
    glassShape.moveTo(-0.95, 0.45);
    glassShape.lineTo(0.95, 0.45);
    glassShape.lineTo(0.95, 2.6);
    glassShape.absarc(0, 2.6, 0.95, 0, Math.PI, false);
    glassShape.lineTo(-0.95, 0.45);
    const reflector = new Reflector(new THREE.ShapeGeometry(glassShape, 32), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: new THREE.Color("#9a9a9a"),
      clipBias: 0.003,
    });
    reflector.position.z = 0.02;
    mirrorGroup.add(reflector);
    // A soft golden glow layered over the glass when the mirror "shows" something.
    const glowMat = new THREE.MeshBasicMaterial({ color: hdr("#ffcf6a", 1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    mirrorGroup.add(mesh(new THREE.ShapeGeometry(glassShape, 32), glowMat, [0, 0, 0.04], [0, 0, 0], { cast: false, receive: false }));
    root.add(mirrorGroup);

    root.add(new THREE.HemisphereLight("#4a4060", "#1a120a", 0.45));
    const key = new THREE.SpotLight("#ffe3b5", 90, 26, 0.6, 0.6, 1.4);
    key.position.set(-3, 8.5, 4);
    key.target.position.set(0, 0, -2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    root.add(key, key.target);
    const torches = [
      torch(ctx.particles, v3(-3.2, 2.8, -7.2), 0.42, "#7dff6a"),
      torch(ctx.particles, v3(3.2, 2.8, -7.2), -0.42, "#7dff6a"),
      torch(ctx.particles, v3(-7.3, 2.8, 0), Math.PI / 2),
      torch(ctx.particles, v3(7.3, 2.8, 0), -Math.PI / 2),
    ];
    torches.forEach((t) => root.add(t.group));
    const mirrorLight = new THREE.PointLight("#ffcf6a", 0, 8, 1.5);
    mirrorLight.position.set(0, 1.8, -4.4);
    const fireLight = new THREE.PointLight("#6a2aaa", 0, 10, 1.5);
    fireLight.position.set(0, 1.2, 6.6);
    root.add(mirrorLight, fireLight);

    let glow = 0;
    let glowT = 0;
    let flames = 0;
    let flamesT = 0;

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(3.2, 3.4, 6.2), look: v3(-0.4, 1.2, -3) },
      bounds: new THREE.Box3(v3(-6.5, 0.3, -6.5), v3(6.5, 8.5, 7.2)),
      background: new THREE.Color("#040304"),
      fog: new THREE.FogExp2("#060406", 0.035),
      environmentIntensity: 0.45,
      music: "dread",
      update(dt, t) {
        torches.forEach((tr) => tr.flame.update(dt, t));
        glow = damp(glow, glowT, 2, dt);
        glowMat.opacity = glow * (0.35 + Math.sin(t * 2) * 0.08);
        mirrorLight.intensity = glow * 10;
        flames = damp(flames, flamesT, 3, dt);
        fireLight.intensity = flames * (12 + noise1(t * 8) * 3);
        if (flames > 0.05) {
          for (let i = 0; i < 3; i++) {
            ctx.particles.soft.emit({ count: 1, at: v3((Math.random() - 0.5) * 3.2, 0.9 + Math.random() * 0.2, 6.9), velocity: v3(0, 1.3, 0), jitter: 0.35, life: [0.7, 1.3], size: [0.7, 1.2], color: new THREE.Color("#120a1c"), colorEnd: new THREE.Color("#000000"), grow: 0.5, alpha: flames * 0.75 });
          }
          if (Math.random() < 0.5) ctx.particles.glow.emit({ count: 1, at: v3((Math.random() - 0.5) * 3.2, 1, 6.9), velocity: v3(0, 1.4, 0), jitter: 0.3, life: [0.3, 0.6], size: [0.12, 0.2], color: hdr("#7a3ac0", 2.5) });
        }
        if (glow > 0.3 && Math.random() < dt * 8) {
          ctx.particles.glow.emit({ count: 1, at: v3((Math.random() - 0.5) * 1.6, 1 + Math.random() * 2, -5.2), velocity: v3(0, 0.15, 0.1), jitter: 0.05, life: [1, 2], size: [0.02, 0.05], color: hdr("#ffd27a", 5) });
        }
      },
      setProp(prop, state, instant) {
        if (prop === "mirror") {
          glowT = state === "glow" ? 1 : 0;
          if (instant) glow = glowT;
          else if (glowT) ctx.audio.sfx("sparkle");
        }
        if (prop === "flames") {
          flamesT = state === "on" ? 1 : 0;
          if (instant) flames = flamesT;
          else if (flamesT) ctx.audio.sfx("fire");
        }
      },
      dispose() {
        reflector.dispose();
      },
    };
  },
};
