import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { damp, noise1, rng } from "../engine/core/math";
import type { LocationDef } from "../engine/world/Location";
import { dust, flagstoneMaterial, mesh, pillar, room, stoneMaterial, autoMarks, v3, woodMaterial } from "./kit";

const MARKS = {
  entry: v3(0, 0, 6.5),
  harry_floor: v3(0, 0, 3.2),
  ron_floor: v3(1.6, 0, 3.9),
  hermione_floor: v3(-1.5, 0, 3.8),
  brooms: v3(4.9, 0, 1.4),
  harry_broom: v3(4.0, 0, 1.6),
  air_high: v3(0.5, 5.5, 1),
  air_key: v3(-2.6, 7.6, -2.2),
  air_silver: v3(2.8, 7.2, -1.4),
  air_dive: v3(0.2, 2.6, -3.6),
  door: v3(0, 0, -7.4),
  door_front: v3(0, 0, -5.8),
  ron_door: v3(1.4, 0, -5.0),
  hermione_door: v3(-1.3, 0, -5.0),
  keyhole: v3(0, 1.3, -7.6),
  ...autoMarks(v3(0, 0, 2.6), v3(2.4, 2.2, 7.2), v3(0, 0, 6.5), 2.0),
};

const N_KEYS = 170;

function keyGeometry(scale = 1): THREE.BufferGeometry {
  const bow = new THREE.TorusGeometry(0.05 * scale, 0.014 * scale, 6, 14);
  bow.translate(0, 0, -0.07 * scale);
  bow.rotateY(Math.PI / 2);
  const shaft = new THREE.CylinderGeometry(0.01 * scale, 0.01 * scale, 0.2 * scale, 6);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, 0.06 * scale);
  const bit = new THREE.BoxGeometry(0.012 * scale, 0.05 * scale, 0.04 * scale);
  bit.translate(0, -0.03 * scale, 0.13 * scale);
  return mergeGeometries([bow.toNonIndexed(), shaft.toNonIndexed(), bit.toNonIndexed()])!;
}

function wingGeometry(scale = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.08 * scale, 0.05 * scale, 0.16 * scale, 0.03 * scale);
  shape.quadraticCurveTo(0.1 * scale, -0.02 * scale, 0, -0.03 * scale);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

export const flyingKeys: LocationDef = {
  id: "flying_keys",
  title: "The Chamber of Winged Keys",
  info: {
    marks: Object.keys(MARKS),
    keywords: ["keys","winged","broomstick","brooms","fluttering"],
    props: {
      keys: ["swarm", "attack"],
      special_key: ["flying", "caught", "in_lock"],
      brooms: ["leaning", "harry_flying"],
      door: ["locked", "open"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const W = 12;
    const H = 13;
    const D = 16;
    root.add(room(W, H, D, stoneMaterial("#7a6e5c", "keys", [4, 4]), flagstoneMaterial("#6e6656", [4, 5]), stoneMaterial("#5a5248", "keysceil", [3, 4])));
    const pillarStone = stoneMaterial("#9a8f78", "keypillar", [1, 3]);
    for (const x of [-5.3, 5.3]) for (const z of [-5, 0, 5]) {
      const p = pillar(H, 0.38, pillarStone);
      p.position.set(x, 0, z);
      root.add(p);
    }
    // Bright, enchanted light from above: this room is lit, unlike the others.
    root.add(new THREE.HemisphereLight("#ffe7c0", "#2a2016", 0.45));
    const sun = new THREE.DirectionalLight("#ffe0a0", 3.2);
    sun.position.set(-4, 14, 6);
    sun.target.position.set(0, 0, -1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 10, bottom: -10, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    root.add(sun, sun.target);
    const glow = new THREE.PointLight("#ffd68a", 20, 18, 1.5);
    glow.position.set(0, 9, -1);
    root.add(glow);

    // Door with a great lock.
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-1.2, 0, -7.85);
    const doorWood = woodMaterial("#4a2e16", [1, 1]);
    doorPivot.add(mesh(new THREE.BoxGeometry(2.4, 3.4, 0.18), doorWood, [1.2, 1.7, 0]));
    const iron = new THREE.MeshStandardMaterial({ color: "#2b2723", metalness: 0.85, roughness: 0.35 });
    for (const y of [0.6, 1.7, 2.8]) doorPivot.add(mesh(new THREE.BoxGeometry(2.4, 0.12, 0.05), iron, [1.2, y, 0.11]));
    doorPivot.add(mesh(new THREE.BoxGeometry(0.4, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: "#8a6a2a", metalness: 0.9, roughness: 0.3 }), [1.2, 1.3, 0.14]));
    root.add(doorPivot);
    root.add(mesh(new THREE.BoxGeometry(3.2, 0.5, 0.5), pillarStone, [0, 3.65, -7.8]));
    root.add(mesh(new THREE.PlaneGeometry(2.4, 3.4), new THREE.MeshBasicMaterial({ color: "#050403" }), [0, 1.7, -7.98], [0, 0, 0], { cast: false }));

    // Brooms leaning on the right wall.
    const broomMat = woodMaterial("#6b4a2a", [1, 1]);
    const twig = new THREE.MeshStandardMaterial({ color: "#8a6a3a", roughness: 1 });
    const makeBroom = () => {
      const b = new THREE.Group();
      b.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.6, 8), broomMat, [0, 0, 0], [Math.PI / 2, 0, 0]));
      b.add(mesh(new THREE.ConeGeometry(0.13, 0.5, 10), twig, [0, 0, -0.95], [-Math.PI / 2, 0, 0]));
      return b;
    };
    const brooms = [0, 1, 2].map((i) => {
      const b = makeBroom();
      b.position.set(5.75, 0.8, 0.8 + i * 0.6);
      b.rotation.set(-Math.PI / 2 + 0.18, 0, 0.1);
      root.add(b);
      return b;
    });

    // The swarm: instanced keys with instanced flapping wings.
    const rand = rng(7);
    const keyMat = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.28 });
    const keys = new THREE.InstancedMesh(keyGeometry(2.2), keyMat, N_KEYS);
    const wingMat = new THREE.MeshStandardMaterial({ color: "#f2ead8", roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    const wingsL = new THREE.InstancedMesh(wingGeometry(2.2), wingMat, N_KEYS);
    const wingsR = new THREE.InstancedMesh(wingGeometry(2.2), wingMat, N_KEYS);
    const palette = ["#e8c25a", "#d9d9e0", "#c08a50", "#b7b089"].map((c) => new THREE.Color(c));
    const birds = Array.from({ length: N_KEYS }, (_, i) => {
      keys.setColorAt(i, palette[i % palette.length]);
      return {
        seed: rand() * 100,
        r: 2 + rand() * 3.4,
        y: 5.5 + rand() * 6,
        speed: 0.25 + rand() * 0.35,
        pos: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        attack: 0,
      };
    });
    keys.castShadow = true;
    for (const m of [keys, wingsL, wingsR]) {
      m.frustumCulled = false;
      root.add(m);
    }

    // The one key that matters: old, big, one wing crumpled.
    const special = new THREE.Group();
    special.add(mesh(keyGeometry(3), new THREE.MeshStandardMaterial({ color: "#a8742e", metalness: 0.9, roughness: 0.45 })));
    const sWingL = mesh(wingGeometry(3.6), wingMat);
    const sWingR = mesh(wingGeometry(2.4), new THREE.MeshStandardMaterial({ color: "#c9b998", roughness: 0.8, side: THREE.DoubleSide }));
    sWingR.scale.set(-1, 1, 0.6);
    special.add(sWingL, sWingR);
    root.add(special);
    // The bright silver decoy hangs near the other side.
    const silver = new THREE.Group();
    silver.add(mesh(keyGeometry(3.6), new THREE.MeshStandardMaterial({ color: "#f4f6ff", metalness: 1, roughness: 0.08, emissive: new THREE.Color("#30343a") })));
    const svL = mesh(wingGeometry(3.4), wingMat);
    const svR = mesh(wingGeometry(3.4), wingMat);
    svR.scale.x = -1;
    silver.add(svL, svR);
    root.add(silver);

    const motes = dust(ctx.particles, v3(0, 6, 0), v3(10, 10, 14), "#fff0c0", 14);
    let attackTarget = 0;
    let specialState = "flying";
    let broomFlying = false;
    let doorOpen = 0;
    let doorTarget = 0;
    const flyingBroom = makeBroom();
    flyingBroom.visible = false;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const wq = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const tmp = new THREE.Vector3();
    const look = new THREE.Matrix4();
    const placeFlyer = (g: THREE.Object3D, p: THREE.Vector3, prev: THREE.Vector3) => {
      g.position.copy(p);
      if (p.distanceToSquared(prev) > 1e-8) g.lookAt(tmp.copy(p).multiplyScalar(2).sub(prev));
    };
    const sPrev = new THREE.Vector3();
    const svPrev = new THREE.Vector3();

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(2.4, 2.2, 7.2), look: v3(-0.6, 3.4, -2) },
      bounds: new THREE.Box3(v3(-5.6, 0.3, -7.6), v3(5.6, 12.5, 7.6)),
      background: new THREE.Color("#1a140c"),
      fog: new THREE.FogExp2("#3a2e1c", 0.018),
      environmentIntensity: 0.6,
      music: "mystery",
      update(dt, t) {
        motes(dt);
        const harry = ctx.actor("harry");
        const hp = harry ? harry.position.clone().add(v3(0, 0.9, 0)) : v3(0, 5, 0);
        for (const [i, b] of birds.entries()) {
          b.attack = damp(b.attack, attackTarget, 1 + (b.seed % 1.5), dt);
          b.prev.copy(b.pos);
          const a = t * b.speed + b.seed;
          b.pos.set(Math.cos(a) * b.r + noise1(t * 0.3, b.seed) * 1.5, b.y + Math.sin(a * 1.7) * 0.8 + noise1(t * 0.4, b.seed + 2), Math.sin(a) * b.r * 1.2 - 1 + noise1(t * 0.35, b.seed + 4) * 1.5);
          if (b.attack > 0.001) {
            const sw = v3(Math.cos(a * 4) * 0.7, Math.sin(a * 3) * 0.7, Math.sin(a * 4) * 0.7);
            b.pos.lerp(sw.add(hp), b.attack);
          }
          if (b.prev.lengthSq() === 0) b.prev.copy(b.pos).add(v3(0.01, 0, 0));
          look.lookAt(b.pos, b.prev, THREE.Object3D.DEFAULT_UP);
          q.setFromRotationMatrix(look);
          m4.compose(b.pos, q, one);
          keys.setMatrixAt(i, m4);
          const flap = Math.sin(t * 28 + b.seed) * 0.9;
          for (const [side, wings] of [
            [1, wingsL],
            [-1, wingsR],
          ] as const) {
            wq.setFromEuler(new THREE.Euler(0, side > 0 ? 0 : Math.PI, side * flap));
            const wm = new THREE.Matrix4().compose(b.pos, q.clone().multiply(wq), one);
            wings.setMatrixAt(i, wm);
          }
        }
        keys.instanceMatrix.needsUpdate = true;
        wingsL.instanceMatrix.needsUpdate = true;
        wingsR.instanceMatrix.needsUpdate = true;

        // Special key: lurching flight with one good wing.
        if (specialState === "flying") {
          sPrev.copy(special.position);
          const c = MARKS.air_key;
          const p = v3(c.x + Math.sin(t * 0.9) * 1.2 + noise1(t * 2, 5) * 0.3, c.y + Math.sin(t * 2.3) * 0.5 - Math.abs(noise1(t * 3, 6)) * 0.4, c.z + Math.cos(t * 0.7) * 1.0);
          placeFlyer(special, p, sPrev);
          sWingL.rotation.z = Math.sin(t * 22) * 0.9;
          sWingR.rotation.z = -0.3 + Math.sin(t * 22) * 0.2;
        }
        svPrev.copy(silver.position);
        const sc = MARKS.air_silver;
        placeFlyer(silver, v3(sc.x + Math.sin(t * 0.8) * 0.5, sc.y + Math.sin(t * 1.9) * 0.25, sc.z + Math.cos(t * 0.8) * 0.5), svPrev);
        svL.rotation.z = Math.sin(t * 26) * 0.9;
        svR.rotation.z = -Math.sin(t * 26) * 0.9;

        doorOpen = damp(doorOpen, doorTarget, 1.5, dt);
        doorPivot.rotation.y = doorOpen * 1.7;
      },
      setProp(prop, state, instant) {
        if (prop === "keys") {
          attackTarget = state === "attack" ? 1 : 0;
          if (instant) birds.forEach((b) => (b.attack = attackTarget));
          else if (attackTarget) ctx.audio.sfx("flutter");
        }
        if (prop === "special_key") {
          specialState = state;
          const harry = ctx.actor("harry");
          if (state === "caught" && harry) {
            const hand = harry.socket("hand_r");
            hand.add(special);
            special.position.set(0, -0.06, 0.05);
            special.rotation.set(0, 0, 0);
            special.scale.setScalar(0.45);
            if (!instant) ctx.audio.sfx("sparkle");
          } else if (state === "in_lock") {
            // Turned in the lock plate, so it swings open with the door.
            doorPivot.add(special);
            special.position.set(1.2, 1.3, 0.32);
            special.rotation.set(0, Math.PI, Math.PI / 2);
            special.scale.setScalar(0.5);
          } else {
            root.add(special);
            special.scale.setScalar(1);
          }
        }
        if (prop === "brooms") {
          broomFlying = state === "harry_flying";
          const harry = ctx.actor("harry");
          brooms[0].visible = !broomFlying;
          if (broomFlying && harry) {
            const hips = harry.socket("hips");
            hips.add(flyingBroom);
            flyingBroom.position.set(0, -0.05, 0.15);
            flyingBroom.rotation.set(Math.PI, 0, 0);
            flyingBroom.visible = true;
          } else {
            flyingBroom.removeFromParent();
            flyingBroom.visible = false;
          }
        }
        if (prop === "door") {
          doorTarget = state === "open" ? 1 : 0;
          if (instant) doorOpen = doorTarget;
          else if (doorTarget) ctx.audio.sfx("door");
        }
      },
      dispose() {
        flyingBroom.removeFromParent();
        special.removeFromParent();
      },
    };
  },
};
