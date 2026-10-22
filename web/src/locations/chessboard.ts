import * as THREE from "three";
import { damp, easeOutCubic, lerp } from "../engine/core/math";
import type { LocationDef } from "../engine/world/Location";
import { mesh, room, stoneMaterial, torch, v3 } from "./kit";

const SQ = 1.6;
// Square name (e.g. "d4") -> world position. Rank 1 is nearest the camera (the black side).
const sq = (name: string, y = 0) => v3(-5.6 + (name.charCodeAt(0) - 97) * SQ, y, 5.6 - (Number(name[1]) - 1) * SQ);

const MARKS = {
  entry: v3(0, 0, 8.4),
  board_center: v3(0, 0, 0),
  ron_d4: sq("d4").add(v3(0.62, 0, 0.35)),
  ron_c5: sq("c5").add(v3(0.62, 0, 0.35)),
  harry_f3: sq("f3"),
  harry_f6: sq("f6"),
  hermione_c2: sq("c2"),
  hermione_ron: sq("c4").add(v3(0.3, 0, 0)),
  white_queen: sq("e7"),
  white_king: sq("g7"),
  exit: v3(0, 0, -8.6),
  exit_harry: v3(0.3, 0, -7.6),
};

type Kind = "pawn" | "rook" | "knight" | "bishop" | "queen" | "king";

function profile(kind: Kind): THREE.Vector2[] {
  const p = (pts: number[][]) => pts.map(([x, y]) => new THREE.Vector2(x, y));
  const base = [
    [0, 0],
    [0.62, 0],
    [0.62, 0.12],
    [0.5, 0.2],
    [0.52, 0.3],
    [0.4, 0.38],
  ];
  switch (kind) {
    case "pawn":
      return p([...base, [0.26, 0.6], [0.2, 0.95], [0.34, 1.02], [0.18, 1.08], [0.3, 1.25], [0.3, 1.4], [0.18, 1.55], [0, 1.6]]);
    case "rook":
      return p([...base, [0.34, 0.6], [0.3, 1.4], [0.46, 1.5], [0.46, 1.85], [0.36, 1.85], [0.36, 1.7], [0, 1.7]]);
    case "bishop":
      return p([...base, [0.28, 0.7], [0.22, 1.35], [0.38, 1.42], [0.22, 1.5], [0.3, 1.75], [0.24, 2.0], [0.1, 2.15], [0.08, 2.2], [0, 2.25]]);
    case "queen":
      return p([...base, [0.32, 0.7], [0.24, 1.55], [0.44, 1.65], [0.26, 1.75], [0.36, 1.95], [0.46, 2.25], [0.2, 2.3], [0.12, 2.42], [0.1, 2.5], [0, 2.52]]);
    case "king":
      return p([...base, [0.34, 0.7], [0.26, 1.6], [0.46, 1.7], [0.28, 1.8], [0.4, 2.1], [0.36, 2.3], [0, 2.3]]);
    case "knight":
      return p([...base, [0.36, 0.55], [0.36, 0.7], [0, 0.72]]);
  }
}

function piece(kind: Kind, mat: THREE.Material, scale = 1.25): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.LatheGeometry(profile(kind), 28), mat));
  if (kind === "knight") {
    // Horse head from a tilted neck and a long muzzle.
    g.add(mesh(new THREE.BoxGeometry(0.42, 1.05, 0.62), mat, [0, 1.15, -0.05], [0.25, 0, 0]));
    g.add(mesh(new THREE.BoxGeometry(0.36, 0.38, 0.8), mat, [0, 1.62, 0.22], [-0.35, 0, 0]));
    g.add(mesh(new THREE.ConeGeometry(0.09, 0.28, 4), mat, [0.12, 1.92, -0.1]));
    g.add(mesh(new THREE.ConeGeometry(0.09, 0.28, 4), mat, [-0.12, 1.92, -0.1]));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.9, 0.18), mat, [0, 1.3, -0.4], [0.25, 0, 0]));
  }
  if (kind === "king") {
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), mat, [0, 2.55, 0]));
    g.add(mesh(new THREE.BoxGeometry(0.36, 0.12, 0.12), mat, [0, 2.6, 0]));
  }
  if (kind === "queen") {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), mat, [Math.cos(a) * 0.4, 2.3, Math.sin(a) * 0.4]));
    }
  }
  if (kind === "rook") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(mesh(new THREE.BoxGeometry(0.18, 0.22, 0.14), mat, [Math.cos(a) * 0.4, 1.95, Math.sin(a) * 0.4], [0, -a, 0]));
    }
  }
  g.scale.setScalar(scale);
  return g;
}

interface Mover {
  g: THREE.Group;
  target: THREE.Vector3;
  from: THREE.Vector3;
  t: number;
  dur: number;
  strike: number;
  topple: number;
  toppleTarget: number;
  onArrive?: () => void;
}

export const chessboard: LocationDef = {
  id: "chessboard",
  title: "The Giant Chessboard",
  info: {
    marks: Object.keys(MARKS),
    props: {
      black_knight: ["d4", "c5", "toppled"],
      white_queen: ["e7", "c5", "f3"],
      white_king: ["standing", "surrender"],
    },
  },
  build(ctx) {
    const root = new THREE.Group();
    const W = 18;
    const H = 10;
    const D = 19;
    root.add(room(W, H, D, stoneMaterial("#4e4a44", "chess", [6, 3]), stoneMaterial("#2a2724", "chessfloor", [6, 6]), stoneMaterial("#26231f", "chessceil", [5, 5])));

    // Board: alternating polished squares.
    const light = new THREE.MeshStandardMaterial({ color: "#d8d0bc", roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: "#2b2622", roughness: 0.35 });
    const sqGeo = new THREE.BoxGeometry(SQ - 0.02, 0.08, SQ - 0.02);
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
      root.add(mesh(sqGeo, (f + r) % 2 ? light : dark, [-5.6 + f * SQ, 0.04, 5.6 - r * SQ], [0, 0, 0], { cast: false }));
    }
    root.add(mesh(new THREE.BoxGeometry(13.4, 0.06, 13.4), new THREE.MeshStandardMaterial({ color: "#1a1714", roughness: 0.6 }), [0, 0.02, 0], [0, 0, 0], { cast: false }));

    const white = new THREE.MeshStandardMaterial({ color: "#e9e3d3", roughness: 0.3, metalness: 0.0 });
    const black = new THREE.MeshStandardMaterial({ color: "#26221e", roughness: 0.32, metalness: 0.0 });
    const place = (kind: Kind, mat: THREE.Material, at: string, yaw = 0) => {
      const g = piece(kind, mat);
      g.position.copy(sq(at, 0.08));
      g.rotation.y = yaw;
      root.add(g);
      return g;
    };
    // A late-game position: enough pieces to read as chess, with lanes for the action.
    for (const s of ["a7", "b6", "h6", "d6"]) place("pawn", white, s);
    place("rook", white, "a8");
    place("bishop", white, "c8");
    place("knight", white, "h8", Math.PI);
    for (const s of ["a3", "b3", "g2", "h3"]) place("pawn", black, s);
    place("rook", black, "a1");
    place("king", black, "e1");
    place("queen", black, "d1");
    // Hermione stands in for a castle and Harry for a bishop, so those squares stay empty.

    const knight = place("knight", black, "d4");
    const queen = place("queen", white, "e7");
    const king = place("king", white, "g7");
    // Captured pieces lie smashed beside the board.
    for (const [i, k] of (["pawn", "bishop", "knight", "pawn"] as Kind[]).entries()) {
      const g = piece(k, i % 2 ? white : black, 1.1);
      g.position.set(-7.6 + (i % 2) * 0.6, 0.4, -4 + i * 2.2);
      g.rotation.set(Math.PI / 2, 0, i);
      root.add(g);
    }

    root.add(new THREE.HemisphereLight("#9aa0c0", "#201a14", 0.5));
    const key = new THREE.SpotLight("#fff2dc", 120, 30, 0.55, 0.5, 1.4);
    key.position.set(3, 9.5, 5);
    key.target.position.set(0, 0, -1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    root.add(key, key.target);
    const torches = [
      torch(ctx.particles, v3(-8.85, 3, -4), Math.PI / 2),
      torch(ctx.particles, v3(-8.85, 3, 4), Math.PI / 2),
      torch(ctx.particles, v3(8.85, 3, -4), -Math.PI / 2),
      torch(ctx.particles, v3(8.85, 3, 4), -Math.PI / 2),
    ];
    torches.forEach((t) => root.add(t.group));
    // Exit doorway beyond the white side.
    root.add(mesh(new THREE.PlaneGeometry(2, 3), new THREE.MeshBasicMaterial({ color: "#060504" }), [0, 1.5, -9.45], [0, 0, 0], { cast: false }));

    const mk = (g: THREE.Group): Mover => (g.rotation.order = "YXZ", { g, target: g.position.clone(), from: g.position.clone(), t: 1, dur: 1, strike: 0, topple: 0, toppleTarget: 0 });
    const movers = { knight: mk(knight), queen: mk(queen), king: mk(king) };
    const moveTo = (m: Mover, to: THREE.Vector3, instant: boolean, onArrive?: () => void) => {
      m.from.copy(m.g.position);
      m.target.copy(to);
      m.t = instant ? 1 : 0;
      m.dur = Math.max(0.6, m.from.distanceTo(to) / 3.2);
      m.onArrive = instant ? undefined : onArrive;
      if (instant) m.g.position.copy(to);
      else ctx.audio.sfx("grind");
    };

    return {
      root,
      marks: MARKS,
      wide: { pos: v3(-2.6, 7.4, 9.6), look: v3(0.6, 0.4, -0.6) },
      bounds: new THREE.Box3(v3(-8.6, 0.3, -9.1), v3(8.6, 9.6, 9.1)),
      background: new THREE.Color("#050505"),
      fog: new THREE.FogExp2("#08080a", 0.03),
      environmentIntensity: 0.35,
      music: "tension",
      update(dt, t) {
        torches.forEach((tr) => tr.flame.update(dt, t));
        for (const m of Object.values(movers)) {
          if (m.t < 1) {
            m.t = Math.min(1, m.t + dt / m.dur);
            m.g.position.lerpVectors(m.from, m.target, easeOutCubic(m.t));
            m.g.position.y = 0.08 + Math.sin(m.t * Math.PI) * 0.15;
            if (m.t >= 1 && m.onArrive) {
              const f = m.onArrive;
              m.onArrive = undefined;
              f();
            }
          }
          // A strike rocks the piece forward and back.
          if (m.strike > 0) {
            m.strike = Math.max(0, m.strike - dt * 1.6);
            m.g.rotation.x = Math.sin((1 - m.strike) * Math.PI) * 0.5;
          }
          m.topple = damp(m.topple, m.toppleTarget, 3, dt);
          if (m.toppleTarget > 0) m.g.rotation.z = lerp(0, Math.PI / 2 - 0.1, m.topple);
          if (m.toppleTarget > 0) m.g.position.y = 0.08 + m.topple * 0.5;
        }
      },
      setProp(prop, state, instant) {
        if (prop === "black_knight") {
          const m = movers.knight;
          if (state === "toppled") {
            m.toppleTarget = 1;
            if (instant) m.topple = 1;
          } else {
            m.toppleTarget = 0;
            m.topple = 0;
            m.g.rotation.z = 0;
            moveTo(m, sq(state, 0.08), instant);
          }
        }
        if (prop === "white_queen") {
          const m = movers.queen;
          const victim = state === "c5" ? movers.knight : null;
          // The queen stops just short of her victim, then strikes.
          const dest = sq(state, 0.08).add(state === "e7" ? v3(0, 0, 0) : v3(0.9, 0, -0.9));
          moveTo(m, dest, instant, () => {
            m.strike = 1;
            ctx.audio.sfx("crash");
            if (victim) victim.toppleTarget = 1;
          });
          const face = sq(state === "e7" ? "e1" : state).sub(state === "e7" ? m.g.position : dest);
          m.g.rotation.set(0, Math.atan2(face.x, face.z), 0);
        }
        if (prop === "white_king") {
          const m = movers.king;
          m.toppleTarget = state === "surrender" ? 1 : 0;
          if (instant) m.topple = m.toppleTarget;
          else if (m.toppleTarget) ctx.audio.sfx("thud");
        }
      },
    };
  },
};
