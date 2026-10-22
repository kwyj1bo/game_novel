import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Preset, PresetType, Scenery } from "../engine/assets/manifest";
import { rng } from "../engine/core/math";
import type { LocationContext, LocationDef, LocationInstance } from "../engine/world/Location";
import {
  AUTO_MARKS,
  autoMarks,
  cobbleMaterial,
  dust,
  flagstoneMaterial,
  groundMaterial,
  mesh,
  plasterMaterial,
  room,
  stoneMaterial,
  tileMaterial,
  v3,
  woodMaterial,
} from "./kit";
import { buildProp, type Prop } from "./props";

// Builds locations from manifest entries, so a scenery is data, not code.
// Every generic location has the auto_* marks and no props, which is all a
// generated story needs.

const OUTDOOR = new Set<PresetType>(["forest", "field", "street", "village", "shore", "lake", "mountain", "garden", "deck"]);
const MAX_PROP_LIGHTS = 6;

interface Layout {
  size: [number, number];
  height: number;
  wall: string;
  floor: string;
  props: [string, number][];
  fog: number;
}

// Sensible defaults per type; a manifest entry overrides any of them.
const LAYOUTS: Record<PresetType, Layout> = {
  room: { size: [8, 8], height: 3.2, wall: "#b8a88a", floor: "wood", props: [["table", 1], ["chair", 2], ["rug", 1], ["candle", 2], ["bookshelf", 1]], fog: 0.02 },
  hall: { size: [14, 20], height: 7, wall: "#6f6a62", floor: "flagstone", props: [["pillar", 8], ["table", 2], ["candle", 6]], fog: 0.025 },
  tavern: { size: [12, 10], height: 3.6, wall: "#7a5a3a", floor: "wood", props: [["table", 4], ["chair", 8], ["barrel", 4], ["fireplace", 1], ["candle", 3]], fog: 0.03 },
  library: { size: [12, 12], height: 5, wall: "#5a4a3a", floor: "wood", props: [["bookshelf", 8], ["desk", 2], ["candle", 4], ["rug", 1]], fog: 0.02 },
  kitchen: { size: [8, 8], height: 3, wall: "#a89a80", floor: "flagstone", props: [["table", 1], ["fireplace", 1], ["barrel", 2], ["crate", 2], ["chair", 2]], fog: 0.02 },
  bedroom: { size: [7, 7], height: 3, wall: "#b0a088", floor: "wood", props: [["bed", 1], ["rug", 1], ["chair", 1], ["candle", 2], ["desk", 1]], fog: 0.015 },
  cellar: { size: [9, 9], height: 2.6, wall: "#4e4a42", floor: "flagstone", props: [["barrel", 6], ["crate", 4], ["candle", 2]], fog: 0.05 },
  classroom: { size: [10, 10], height: 3.6, wall: "#a89a80", floor: "wood", props: [["desk", 6], ["chair", 6], ["bookshelf", 2], ["candle", 2]], fog: 0.015 },
  shop: { size: [8, 8], height: 3.2, wall: "#9a8a6a", floor: "wood", props: [["stall", 1], ["bookshelf", 3], ["crate", 3], ["barrel", 1], ["candle", 2]], fog: 0.02 },
  chapel: { size: [10, 16], height: 8, wall: "#7a7262", floor: "flagstone", props: [["pew", 6], ["candle", 8], ["pillar", 4]], fog: 0.025 },
  cave: { size: [12, 12], height: 5, wall: "#4a4640", floor: "dirt", props: [["rock", 12], ["candle", 2]], fog: 0.06 },
  forest: { size: [60, 60], height: 0, wall: "", floor: "#3a5a28", props: [["pine", 26], ["tree", 16], ["bush", 14], ["rock", 8]], fog: 0.045 },
  field: { size: [60, 60], height: 0, wall: "", floor: "#6a8a3a", props: [["bush", 6], ["fence", 8], ["tree", 4], ["rock", 4]], fog: 0.015 },
  street: { size: [16, 40], height: 0, wall: "", floor: "cobble", props: [["house", 10], ["lamp_post", 6], ["cart", 1], ["barrel", 3]], fog: 0.02 },
  village: { size: [50, 50], height: 0, wall: "", floor: "#5a7a34", props: [["house", 7], ["fence", 6], ["well", 1], ["tree", 6], ["cart", 1]], fog: 0.018 },
  shore: { size: [50, 50], height: 0, wall: "", floor: "#c8b88a", props: [["rock", 9], ["boat", 1]], fog: 0.015 },
  lake: { size: [50, 50], height: 0, wall: "", floor: "#4a6a2e", props: [["tree", 10], ["rock", 4], ["boat", 1], ["bush", 6]], fog: 0.02 },
  mountain: { size: [60, 60], height: 0, wall: "", floor: "#6a665e", props: [["rock", 20], ["pine", 10]], fog: 0.04 },
  garden: { size: [40, 40], height: 0, wall: "", floor: "#4f7a30", props: [["bush", 16], ["tree", 5], ["fence", 10], ["well", 1]], fog: 0.015 },
  deck: { size: [8, 20], height: 0, wall: "", floor: "deck", props: [["mast", 2], ["barrel", 4], ["crate", 3]], fog: 0.02 },
};

const SKY: Record<string, { top: string; bottom: string; sun: string; sunI: number; hemi: number; fog: string }> = {
  day: { top: "#6a9ad8", bottom: "#d8e6f0", sun: "#fff2d8", sunI: 3.2, hemi: 1.0, fog: "#c8d8e4" },
  dusk: { top: "#3a3a6a", bottom: "#e89a6a", sun: "#ff9a5a", sunI: 2.2, hemi: 0.6, fog: "#b8846a" },
  night: { top: "#04060e", bottom: "#141c30", sun: "#8aa0d8", sunI: 0.9, hemi: 0.3, fog: "#0a0e18" },
};

function floorMaterial(kind: string, repeat: [number, number]): THREE.MeshStandardMaterial {
  if (kind === "wood" || kind === "deck") return woodMaterial(kind === "deck" ? "#7a5a38" : "#6a4a2a", repeat);
  if (kind === "flagstone") return flagstoneMaterial("#5d5850", repeat);
  if (kind === "cobble") return cobbleMaterial("#6a645a", repeat);
  if (kind === "tile") return tileMaterial("#b9b2a2", repeat);
  if (kind === "dirt") return groundMaterial("#4a3e30", "dirt", repeat, 0.3);
  return groundMaterial(kind, "grass", repeat, 0.25);
}

function wallMaterial(type: PresetType, tint: string, repeat: [number, number]): THREE.MeshStandardMaterial {
  if (type === "tavern" || type === "library") return woodMaterial(tint, repeat);
  if (type === "room" || type === "bedroom" || type === "kitchen" || type === "classroom" || type === "shop") return plasterMaterial(tint, repeat);
  return stoneMaterial(tint, `generic-${type}`, repeat);
}

function skyDome(time: string): THREE.Mesh {
  const s = SKY[time];
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(s.top) }, bottom: { value: new THREE.Color(s.bottom) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), mat);
  dome.renderOrder = -1;
  return dome;
}

function stars(): THREE.Points {
  const r = rng(5);
  const pos = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const th = r() * Math.PI * 2;
    const y = 0.15 + r() * 0.85;
    const rr = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * rr * 170, y * 170, Math.sin(th) * rr * 170], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: "#dfe8ff", size: 0.8, sizeAttenuation: true, fog: false }));
}

// Places props: indoors along the walls and in the corners, outdoors in a
// ring around the stage. The stage (where the cast stands) stays clear.
function scatter(props: Prop[], type: PresetType, size: [number, number], seed: number, camera: THREE.Vector3): void {
  const r = rng(seed * 31 + 7);
  const [w, d] = size;
  const stageR = type === "deck" ? 1.8 : OUTDOOR.has(type) ? 5 : Math.min(w, d) * 0.28;
  const placed: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: stageR }];
  // Nothing may stand on top of the camera or between it and the stage.
  placed.push({ x: camera.x, z: camera.z, r: OUTDOOR.has(type) ? 4 : 1.2 }, { x: camera.x / 2, z: camera.z / 2, r: OUTDOOR.has(type) ? 2.5 : 0.8 });
  const fits = (x: number, z: number, rad: number) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + rad);
  for (const p of props) {
    let ok = false;
    for (let attempt = 0; attempt < 80 && !ok; attempt++) {
      let x: number;
      let z: number;
      let yaw: number;
      if (!OUTDOOR.has(type) && (p.wall || r() < 0.5)) {
        // Against a wall (not the front wall, which the camera looks through).
        const side = Math.floor(r() * 3);
        if (side === 0) [x, z, yaw] = [(r() - 0.5) * (w - 2), -d / 2 + p.radius * 0.6, 0];
        else if (side === 1) [x, z, yaw] = [-w / 2 + p.radius * 0.6, (r() - 0.5) * (d - 2), Math.PI / 2];
        else [x, z, yaw] = [w / 2 - p.radius * 0.6, (r() - 0.5) * (d - 2), -Math.PI / 2];
      } else if (type === "deck") {
        // On the planks, never over the side.
        [x, z, yaw] = [(r() - 0.5) * (w - 1.6), (r() - 0.5) * (d - 2), r() * Math.PI * 2];
      } else if (type === "street" && p.radius > 2) {
        // Houses line both sides of the street, facing it.
        const left = r() < 0.5;
        // Only up the street, ahead of the camera.
        [x, z, yaw] = [(left ? -1 : 1) * (w / 2 + 1), 4 - r() * (d / 2 + 4), left ? Math.PI / 2 : -Math.PI / 2];
      } else {
        const lim = OUTDOOR.has(type) ? Math.min(w, d) * 0.45 : Math.min(w, d) * 0.45;
        const a = r() * Math.PI * 2;
        const dist = stageR + p.radius + r() * (lim - stageR);
        [x, z, yaw] = [Math.cos(a) * dist, Math.sin(a) * dist, r() * Math.PI * 2];
        // Keep the camera's line of sight (front, +z) mostly open.
        if (z > stageR && Math.abs(x) < stageR * 1.5 && r() < 0.8) continue;
      }
      if (fits(x, z, p.radius)) {
        p.group.position.set(x, 0, z);
        p.group.rotation.y = yaw;
        placed.push({ x, z, r: p.radius });
        ok = true;
      }
    }
    if (!ok) p.group.visible = false;
  }
}

export function presetLocation(s: Scenery): LocationDef {
  const preset = s.preset as Preset;
  const base = LAYOUTS[preset.type];
  const size = preset.size ?? base.size;
  const height = preset.height ?? base.height;
  const outdoor = OUTDOOR.has(preset.type);
  const [w, d] = size;
  const wide = outdoor ? { pos: v3(3.5, 2.8, 9.5), look: v3(-0.3, 1.2, -1) } : { pos: v3(w * 0.28, Math.min(height - 0.4, 2.6), d / 2 - 0.6), look: v3(-0.3, 1.1, -d * 0.12) };
  const entry = outdoor ? v3(1.5, 0, 8) : v3(w / 2 - 1, 0, d / 2 - 1.2);
  const marks = autoMarks(v3(0, 0, 0), wide.pos, entry, Math.min(1.8, Math.min(w, d) * 0.2));
  return {
    id: s.id,
    title: s.title,
    info: { marks: [...AUTO_MARKS], props: {}, keywords: s.keywords },
    build(ctx: LocationContext): LocationInstance {
      const root = new THREE.Group();
      const time = outdoor ? preset.time : preset.time;
      const sky = SKY[time];
      const night = time === "night";
      const floorKind = preset.floor ?? base.floor;
      if (outdoor) {
        // One texture repeat per few metres; cobbles need a much finer repeat.
        const tile = floorKind === "cobble" ? 1.6 : floorKind === "deck" ? 2 : 4;
        root.add(mesh(new THREE.PlaneGeometry(w * 3, d * 3), floorMaterial(floorKind, [(w * 3) / tile, (d * 3) / tile]), [0, 0, 0], [-Math.PI / 2, 0, 0], { cast: false }));
        root.add(skyDome(time));
        if (night) root.add(stars());
        if (preset.type === "shore" || preset.type === "lake") {
          const water = new THREE.MeshStandardMaterial({ color: night ? "#0a1a2a" : "#2a5a7a", roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.92 });
          root.add(mesh(new THREE.PlaneGeometry(w * 3, d * 1.2), water, [0, 0.03, -d * 0.75], [-Math.PI / 2, 0, 0], { cast: false }));
        }
        if (preset.type === "deck") {
          const sea = new THREE.MeshStandardMaterial({ color: night ? "#06121c" : "#1f4a66", roughness: 0.1, metalness: 0.2 });
          root.add(mesh(new THREE.PlaneGeometry(400, 400), sea, [0, -1.5, 0], [-Math.PI / 2, 0, 0], { cast: false }));
          root.children[0].scale.set(w / (w * 3), d / (d * 3), 1);
          const rail = woodMaterial("#5a3a20");
          for (const x of [-w / 2, w / 2]) root.add(mesh(new THREE.BoxGeometry(0.15, 1.0, d), rail, [x, 0.5, 0]));
        }
        const sun = new THREE.DirectionalLight(sky.sun, sky.sunI);
        sun.position.set(-20, time === "dusk" ? 8 : 30, 12);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 90 });
        sun.shadow.bias = -0.0005;
        root.add(sun, sun.target, new THREE.HemisphereLight(sky.top, "#4a3a28", sky.hemi));
      } else {
        const wallTint = preset.wall ?? base.wall;
        const walls = wallMaterial(preset.type, wallTint, [w / 3, height / 2.5]);
        const shell = preset.type === "cave" ? caveShell(w, height, d) : room(w, height, d, walls, floorMaterial(floorKind, [w / 3, d / 3]), stoneMaterial("#3a3632", "genceil", [w / 4, d / 4]));
        root.add(shell);
        if (preset.type !== "cave" && preset.type !== "cellar") {
          // Windows on the back wall: daylight or a dark night sky.
          const glass = new THREE.MeshBasicMaterial({ color: night ? "#1a2440" : new THREE.Color("#dfeaf8").multiplyScalar(1.6) });
          for (const x of [-w * 0.25, w * 0.25]) root.add(mesh(new THREE.PlaneGeometry(1.1, 1.5), glass, [x, Math.min(height - 1, 2.2), -d / 2 + 0.02], [0, 0, 0], { cast: false }));
        }
        root.add(new THREE.HemisphereLight(night ? "#3a3a55" : "#d8d0c0", "#2a2016", night ? 0.35 : 0.8));
        // Off to one side and toward the camera, so faces get modelling, not a hotspot.
        const key = new THREE.SpotLight(night ? "#ffcf9a" : "#fff0dc", night ? 22 : 34, Math.max(w, d) * 2.5, 0.95, 0.7, 1.4);
        key.position.set(w * 0.35, height - 0.2, d * 0.4);
        key.target.position.set(0, 0, -d * 0.1);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.bias = -0.0008;
        root.add(key, key.target);
      }

      const props: Prop[] = [];
      const list = preset.props.length ? preset.props.map((p) => [p.kind, p.count] as [string, number]) : base.props;
      let n = 0;
      for (const [kind, count] of list) for (let i = 0; i < count; i++) props.push(buildProp(kind, ctx.particles, night, preset.seed * 1000 + n++));
      if (preset.type === "hall" || preset.type === "chapel") props.filter((p) => p.radius === 0.6).forEach((p, i) => (p.group.userData.row = i));
      scatter(props, preset.type, size, preset.seed, wide.pos);
      let lights = 0;
      for (const p of props) {
        root.add(p.group);
        if (p.light && (++lights > MAX_PROP_LIGHTS || !p.group.visible)) p.light.removeFromParent();
      }
      const updates = props.filter((p) => p.update && p.group.visible).map((p) => p.update!);
      const motes = dust(ctx.particles, v3(0, 2, 0), v3(Math.min(w, 14), 3, Math.min(d, 14)), night ? "#b8c8ff" : "#ffe6b0", 5);
      const span = outdoor ? 30 : 0;
      return {
        root,
        marks,
        wide,
        bounds: outdoor ? new THREE.Box3(v3(-span, 0.3, -span), v3(span, 30, span)) : new THREE.Box3(v3(-w / 2 + 0.3, 0.3, -d / 2 + 0.3), v3(w / 2 - 0.3, height - 0.2, d / 2 - 0.3)),
        background: new THREE.Color(outdoor ? sky.bottom : "#050505"),
        fog: new THREE.FogExp2(outdoor ? sky.fog : night ? "#06070a" : "#1a1612", base.fog),
        environmentIntensity: outdoor && !night ? 0.6 : 0.3,
        music: s.music ?? (night || preset.type === "cave" || preset.type === "cellar" ? "dread" : "mystery"),
        update(dt, t) {
          for (const u of updates) u(dt, t);
          motes(dt);
        },
        setProp() {},
      };
    },
  };
}

function caveShell(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  const r = rng(11);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (r() - 0.5) * 0.12;
    pos.setXYZ(i, pos.getX(i) * (w / 2) * k, pos.getY(i) * h * k, pos.getZ(i) * (d / 2) * k);
  }
  geo.computeVertexNormals();
  const rockMat = stoneMaterial("#4a4640", "cave", [6, 3]);
  rockMat.side = THREE.BackSide;
  g.add(mesh(geo, rockMat, [0, 0, 0], [0, 0, 0], { cast: false }));
  g.add(mesh(new THREE.CircleGeometry(Math.max(w, d) / 2, 32), floorMaterial("dirt", [w / 3, d / 3]), [0, 0.01, 0], [-Math.PI / 2, 0, 0], { cast: false }));
  return g;
}

// glTF scenery: the file is loaded once; empties named "mark_<name>" become
// marks. Missing auto_* marks are derived from the model's bounding box.
export function modelLocation(s: Scenery): LocationDef {
  let template: THREE.Group | null = null;
  return {
    id: s.id,
    title: s.title,
    info: { marks: [...AUTO_MARKS], props: {}, keywords: s.keywords },
    async preload() {
      if (template) return;
      const gltf = await new GLTFLoader().loadAsync(s.model!);
      template = gltf.scene;
    },
    build(ctx): LocationInstance {
      if (!template) throw new Error(`scenery ${s.id} was not preloaded`);
      const root = template.clone(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3()).setY(0);
      const marks: Record<string, THREE.Vector3> = {};
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = o.receiveShadow = true;
        }
        if (o.name.startsWith("mark_")) marks[o.name.slice(5)] = o.getWorldPosition(new THREE.Vector3());
      });
      const reach = Math.max(4, Math.min(size.x, size.z) * 0.45);
      const wide = { pos: center.clone().add(v3(reach * 0.4, 2.6, reach)), look: center.clone().add(v3(0, 1.1, 0)) };
      const auto = autoMarks(center, wide.pos, center.clone().add(v3(reach * 0.3, 0, reach * 0.8)), Math.min(1.8, reach * 0.4));
      for (const k of AUTO_MARKS) marks[k] ??= auto[k];
      let lit = false;
      root.traverse((o) => (lit ||= o instanceof THREE.Light));
      if (!lit) {
        const sun = new THREE.DirectionalLight("#fff2d8", 2.6);
        sun.position.set(-10, 20, 10);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        root.add(sun, sun.target, new THREE.HemisphereLight("#cfe0ff", "#4a3a28", 0.9));
      }
      void ctx;
      return {
        root,
        marks,
        wide,
        bounds: box.clone().expandByScalar(2).setFromCenterAndSize(box.getCenter(new THREE.Vector3()), size.clone().add(v3(20, 20, 20))),
        background: new THREE.Color("#c8d8e4"),
        fog: new THREE.FogExp2("#c8d8e4", 0.012),
        music: s.music ?? "mystery",
        update() {},
        setProp() {},
      };
    },
  };
}
