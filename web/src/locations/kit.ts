import * as THREE from "three";
import { flame, type Particles } from "../engine/fx/Particles";
import { noise1, rng } from "../engine/core/math";

// Procedural building blocks shared by locations: canvas-generated PBR-ish
// textures, room shells, torches and candles. No image files involved.

const texCache = new Map<string, { map: THREE.Texture; normal: THREE.Texture; rough?: THREE.Texture }>();

type Painter = (ctx: CanvasRenderingContext2D, h: Float32Array, size: number, rand: () => number) => void;

export function makeTextures(key: string, size: number, paint: Painter) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const height = new Float32Array(size * size).fill(0.5);
  paint(ctx, height, size, rng(key.length * 9973 + key.charCodeAt(0)));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normal = new THREE.CanvasTexture(normalFromHeight(height, size, 3));
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  const out = { map, normal };
  texCache.set(key, out);
  return out;
}

function normalFromHeight(h: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function speckle(ctx: CanvasRenderingContext2D, h: Float32Array, size: number, rand: () => number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const l = rand() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${l},${l},${l},${alpha * rand()})`;
    const s = 1 + rand() * 2;
    ctx.fillRect(x, y, s, s);
    const idx = Math.floor(y) * size + Math.floor(x);
    if (idx < h.length) h[idx] += (l ? 1 : -1) * 0.05;
  }
}

// Stone blocks with mortar. `tint` shifts the base colour.
export function stoneMaterial(tint = "#6f6a62", key = "stone", repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  const t = makeTextures(`stone:${tint}:${key}`, 512, (ctx, h, size, rand) => {
    const base = new THREE.Color(tint);
    ctx.fillStyle = "#2a2724";
    ctx.fillRect(0, 0, size, size);
    h.fill(0.1);
    const rows = 8;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? 0.5 : 0;
      const cols = 4;
      const cw = size / cols;
      for (let c = -1; c <= cols; c++) {
        const x0 = (c + offset) * cw + 3;
        const y0 = r * rh + 3;
        const w = cw - 6 + (rand() - 0.5) * 6;
        const hh = rh - 6;
        const v = 0.75 + rand() * 0.45;
        const col = base.clone().multiplyScalar(v);
        col.offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.05, 0);
        ctx.fillStyle = `#${col.getHexString()}`;
        ctx.beginPath();
        ctx.roundRect(x0, y0, w, hh, 5);
        ctx.fill();
        for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, y0 + hh); y++) {
          for (let x = Math.floor(x0); x < x0 + w; x++) {
            const xx = ((x % size) + size) % size;
            const edge = Math.min(x - x0, x0 + w - x, y - y0, y0 + hh - y);
            h[y * size + xx] = 0.55 + Math.min(1, edge / 6) * 0.35 + noise1(x * 0.08 + y * 0.05, r * 7 + c) * 0.05;
          }
        }
      }
    }
    // Grime gradient and speckle.
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(20,15,10,0.25)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, h, size, rand, 9000, 0.18);
  });
  return texturedMaterial(t, repeat, 0.92);
}

// Large irregular flagstones for floors.
export function flagstoneMaterial(tint = "#5d5850", repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  const t = makeTextures(`flag:${tint}`, 512, (ctx, h, size, rand) => {
    const base = new THREE.Color(tint);
    ctx.fillStyle = "#1e1c1a";
    ctx.fillRect(0, 0, size, size);
    h.fill(0.1);
    const n = 4;
    const cell = size / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const col = base.clone().multiplyScalar(0.7 + rand() * 0.5);
        ctx.fillStyle = `#${col.getHexString()}`;
        const x0 = x * cell + 4;
        const y0 = y * cell + 4;
        ctx.beginPath();
        ctx.roundRect(x0, y0, cell - 8, cell - 8, 10);
        ctx.fill();
        for (let yy = Math.floor(y0); yy < y0 + cell - 8; yy++)
          for (let xx = Math.floor(x0); xx < x0 + cell - 8; xx++) {
            const edge = Math.min(xx - x0, x0 + cell - 8 - xx, yy - y0, y0 + cell - 8 - yy);
            h[yy * size + xx] = 0.5 + Math.min(1, edge / 10) * 0.3 + noise1(xx * 0.05, yy * 0.07 + x + y * 3) * 0.08;
          }
      }
    }
    speckle(ctx, h, size, rand, 12000, 0.2);
  });
  return texturedMaterial(t, repeat, 0.85);
}

// Noisy ground: grass, sand, dirt. Blotches of the base colour plus fine grain.
export function groundMaterial(tint: string, key: string, repeat: [number, number] = [1, 1], grain = 0.25): THREE.MeshStandardMaterial {
  const t = makeTextures(`ground:${key}:${tint}`, 256, (ctx, h, size, rand) => {
    const base = new THREE.Color(tint);
    ctx.fillStyle = `#${base.getHexString()}`;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const c = base.clone().multiplyScalar(0.8 + rand() * 0.4);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 4 + rand() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = 0.5 + noise1(x * 0.21 + y * 0.13, 3) * grain;
    speckle(ctx, h, size, rand, 9000, grain);
  });
  return texturedMaterial(t, repeat, 0.95);
}

// Smooth painted plaster with faint mottling, for houses and inns.
export function plasterMaterial(tint = "#c8b89a", repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  return groundMaterial(tint, "plaster", repeat, 0.08);
}

// Small rounded cobbles for streets and courtyards.
export function cobbleMaterial(tint = "#6a645a", repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  const t = makeTextures(`cobble:${tint}`, 256, (ctx, h, size, rand) => {
    const base = new THREE.Color(tint);
    ctx.fillStyle = "#24221e";
    ctx.fillRect(0, 0, size, size);
    h.fill(0.1);
    const n = 8;
    const cell = size / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const cx = (x + 0.5 + (y % 2) * 0.5) * cell;
        const cy = (y + 0.5) * cell;
        const r = cell * (0.38 + rand() * 0.08);
        ctx.fillStyle = `#${base.clone().multiplyScalar(0.75 + rand() * 0.5).getHexString()}`;
        ctx.beginPath();
        ctx.ellipse(cx % size, cy, r, r * 0.85, rand(), 0, Math.PI * 2);
        ctx.fill();
        for (let yy = Math.floor(cy - r); yy < cy + r; yy++)
          for (let xx = Math.floor(cx - r); xx < cx + r; xx++) {
            const d = Math.hypot(xx - cx, yy - cy) / r;
            if (d < 1 && yy >= 0 && yy < size) h[yy * size + (((xx % size) + size) % size)] = 0.3 + (1 - d * d) * 0.6;
          }
      }
  });
  return texturedMaterial(t, repeat, 0.8);
}

// Square glazed tiles with grout, for bathrooms and kitchens.
export function tileMaterial(tint = "#d8d2c4", repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  const t = makeTextures(`tile:${tint}`, 256, (ctx, h, size, rand) => {
    const base = new THREE.Color(tint);
    ctx.fillStyle = "#5a564e";
    ctx.fillRect(0, 0, size, size);
    h.fill(0.2);
    const n = 4;
    const cell = size / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = base.clone().multiplyScalar(0.9 + rand() * 0.15);
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
        for (let yy = y * cell + 2; yy < (y + 1) * cell - 2; yy++) for (let xx = x * cell + 2; xx < (x + 1) * cell - 2; xx++) h[yy * size + xx] = 0.8;
      }
    }
    speckle(ctx, h, size, rand, 2500, 0.1);
  });
  const m = texturedMaterial(t, repeat, 0.25);
  m.normalScale.set(0.5, 0.5);
  return m;
}

export function woodMaterial(tint = "#5a3a22", repeat: [number, number] = [1, 1]): THREE.MeshStandardMaterial {
  const t = makeTextures(`wood:${tint}`, 256, (ctx, h, size, rand) => {
    const base = new THREE.Color(tint);
    const planks = 4;
    const pw = size / planks;
    for (let p = 0; p < planks; p++) {
      const pc = base.clone().multiplyScalar(0.8 + rand() * 0.35);
      for (let x = 0; x < pw; x++) {
        for (let y = 0; y < size; y++) {
          const grain = Math.sin((x + noise1(y * 0.04, p) * 6) * 0.9) * 0.08 + noise1(y * 0.3 + x, p * 5) * 0.04;
          const c = pc.clone().multiplyScalar(1 + grain);
          ctx.fillStyle = `#${c.getHexString()}`;
          ctx.fillRect(p * pw + x, y, 1, 1);
          h[y * size + p * pw + x] = 0.5 + grain * 2 - (x < 2 || x > pw - 2 ? 0.4 : 0);
        }
      }
    }
  });
  return texturedMaterial(t, repeat, 0.75);
}

export function texturedMaterial(t: { map: THREE.Texture; normal: THREE.Texture }, repeat: [number, number], roughness: number) {
  const map = t.map.clone();
  const normal = t.normal.clone();
  map.repeat.set(...repeat);
  normal.repeat.set(...repeat);
  map.needsUpdate = normal.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness });
}

export function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  opts: { cast?: boolean; receive?: boolean } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

// Box room open on no side; walls face inward. Size in metres, floor at y=0.
export function room(w: number, h: number, d: number, wall: THREE.Material, floor: THREE.Material, ceiling?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.PlaneGeometry(w, d), floor, [0, 0, 0], [-Math.PI / 2, 0, 0], { cast: false }));
  if (ceiling) g.add(mesh(new THREE.PlaneGeometry(w, d), ceiling, [0, h, 0], [Math.PI / 2, 0, 0], { cast: false }));
  g.add(mesh(new THREE.PlaneGeometry(w, h), wall, [0, h / 2, -d / 2], [0, 0, 0], { cast: false }));
  g.add(mesh(new THREE.PlaneGeometry(w, h), wall, [0, h / 2, d / 2], [0, Math.PI, 0], { cast: false }));
  g.add(mesh(new THREE.PlaneGeometry(d, h), wall, [-w / 2, h / 2, 0], [0, Math.PI / 2, 0], { cast: false }));
  g.add(mesh(new THREE.PlaneGeometry(d, h), wall, [w / 2, h / 2, 0], [0, -Math.PI / 2, 0], { cast: false }));
  return g;
}

// Pillar with base and capital.
export function pillar(height: number, radius: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(radius, radius * 1.05, height, 16), mat, [0, height / 2, 0]));
  g.add(mesh(new THREE.BoxGeometry(radius * 2.8, 0.25, radius * 2.8), mat, [0, 0.125, 0]));
  g.add(mesh(new THREE.BoxGeometry(radius * 2.8, 0.25, radius * 2.8), mat, [0, height - 0.125, 0]));
  return g;
}

export interface Flame {
  update(dt: number, t: number): void;
  light: THREE.PointLight;
}

// Wall torch: bracket, stick, flickering flame particles and a point light.
export function torch(p: Particles, pos: THREE.Vector3, facing: number, color = "#ff8a2a", shadow = false): { group: THREE.Group; flame: Flame } {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = facing;
  const iron = new THREE.MeshStandardMaterial({ color: "#222", metalness: 0.7, roughness: 0.5 });
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.3, 0.06), iron, [0, -0.15, -0.02]));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.55, 8), new THREE.MeshStandardMaterial({ color: "#4a3018", roughness: 0.9 }), [0, 0.0, 0.18], [0.5, 0, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.12, 8, 1, true), iron, [0, 0.24, 0.3], [0.5, 0, 0]));
  const tip = new THREE.Vector3(0, 0.32, 0.34);
  const light = new THREE.PointLight(color, 6, 9, 2);
  light.position.copy(tip).add(new THREE.Vector3(0, 0.15, 0.1));
  light.castShadow = shadow;
  if (shadow) {
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.004;
  }
  g.add(light);
  const world = new THREE.Vector3();
  const seed = pos.x * 3.1 + pos.z * 1.7;
  return {
    group: g,
    flame: {
      light,
      update(dt, t) {
        g.localToWorld(world.copy(tip));
        flame(p, world, 1, color, dt);
        light.intensity = 6 * (0.82 + noise1(t * 7, seed) * 0.12 + noise1(t * 17, seed + 1) * 0.06);
      },
    },
  };
}

export function candle(p: Particles, pos: THREE.Vector3, height = 0.25): { group: THREE.Group; update: (dt: number, t: number) => void } {
  const g = new THREE.Group();
  g.position.copy(pos);
  const wax = new THREE.MeshStandardMaterial({ color: "#efe6d0", roughness: 0.6, emissive: new THREE.Color("#3a2a10"), emissiveIntensity: 0.4 });
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, height, 10), wax, [0, height / 2, 0]));
  const w = new THREE.Vector3();
  const tip = new THREE.Vector3(0, height + 0.03, 0);
  return {
    group: g,
    update(dt) {
      g.localToWorld(w.copy(tip));
      if (Math.random() < 0.6) flame(p, w, 0.35, "#ffb347", dt);
    },
  };
}

// Floating dust motes that catch the light: slow, ambient life in a room.
export function dust(p: Particles, center: THREE.Vector3, size: THREE.Vector3, color = "#ffd9a0", rate = 6) {
  const at = new THREE.Vector3();
  return (dt: number) => {
    const n = rate * dt;
    if (Math.random() > n) return;
    at.set(center.x + (Math.random() - 0.5) * size.x, center.y + (Math.random() - 0.5) * size.y, center.z + (Math.random() - 0.5) * size.z);
    p.glow.emit({
      count: 1,
      at,
      velocity: new THREE.Vector3(0, 0.03, 0),
      jitter: 0.05,
      life: [4, 7],
      size: [0.015, 0.03],
      color: new THREE.Color(color).multiplyScalar(0.9),
      alpha: 0.6,
    });
  };
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Generic marks every location provides, so generated stories can stage any
// cast without knowing the room: auto_1..auto_5 on an arc facing the wide
// camera, auto_threat across from them, auto_entry where people come in.
export const AUTO_MARKS = ["auto_1", "auto_2", "auto_3", "auto_4", "auto_5", "auto_threat", "auto_entry"] as const;

export function autoMarks(center: THREE.Vector3, camera: THREE.Vector3, entry: THREE.Vector3, radius = 1.8): Record<string, THREE.Vector3> {
  const dir = camera.clone().sub(center).setY(0).normalize();
  const arcCenter = center.clone().addScaledVector(dir, -radius * 0.4);
  const out: Record<string, THREE.Vector3> = {};
  [0, -28, 28, -56, 56].forEach((deg, i) => {
    const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
    out[`auto_${i + 1}`] = arcCenter.clone().addScaledVector(d, radius).setY(0);
  });
  out.auto_threat = center.clone().addScaledVector(dir, -radius * 1.5).setY(0);
  out.auto_entry = entry.clone().setY(0);
  return out;
}
