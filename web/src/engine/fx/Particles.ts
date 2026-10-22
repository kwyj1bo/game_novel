import * as THREE from "three";

export interface EmitOptions {
  count: number;
  at: THREE.Vector3;
  // Random offset radius around `at`.
  spread?: number;
  // Initial velocity: base + random sphere * jitter.
  velocity?: THREE.Vector3;
  jitter?: number;
  life?: [number, number];
  size?: [number, number];
  // Colour at birth and death; values > 1 glow under bloom.
  color: THREE.Color;
  colorEnd?: THREE.Color;
  gravity?: number;
  drag?: number;
  // Size multiplier at end of life.
  grow?: number;
  alpha?: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, uSoft, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

// CPU-simulated pooled point particles. One instance per blend mode.
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly size: Float32Array;
  private readonly size0: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly params: Float32Array; // gravity, drag, grow, alpha
  private cursor = 0;
  private readonly geo: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.params = new Float32Array(max * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: 0.0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 0.6;
  }

  emit(o: EmitOptions): void {
    const v = o.velocity ?? new THREE.Vector3();
    const jitter = o.jitter ?? 0;
    const spread = o.spread ?? 0;
    const [l0, l1] = o.life ?? [0.6, 1.2];
    const [s0, s1] = o.size ?? [0.05, 0.12];
    const end = o.colorEnd ?? o.color;
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      const rs = randomInSphere();
      this.pos[i3] = o.at.x + rs[0] * spread;
      this.pos[i3 + 1] = o.at.y + rs[1] * spread;
      this.pos[i3 + 2] = o.at.z + rs[2] * spread;
      const rj = randomInSphere();
      this.vel[i3] = v.x + rj[0] * jitter;
      this.vel[i3 + 1] = v.y + rj[1] * jitter;
      this.vel[i3 + 2] = v.z + rj[2] * jitter;
      this.col0[i3] = o.color.r;
      this.col0[i3 + 1] = o.color.g;
      this.col0[i3 + 2] = o.color.b;
      this.col1[i3] = end.r;
      this.col1[i3 + 1] = end.g;
      this.col1[i3 + 2] = end.b;
      this.size0[i] = s0 + Math.random() * (s1 - s0);
      this.maxLife[i] = this.life[i] = l0 + Math.random() * (l1 - l0);
      this.params[i * 4] = o.gravity ?? 0;
      this.params[i * 4 + 1] = o.drag ?? 0;
      this.params[i * 4 + 2] = o.grow ?? 1;
      this.params[i * 4 + 3] = o.alpha ?? 1;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const g = this.params[i * 4];
      const drag = Math.max(0, 1 - this.params[i * 4 + 1] * dt);
      this.vel[i3 + 1] -= g * dt;
      this.vel[i3] *= drag;
      this.vel[i3 + 1] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const u = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.col[i3] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * u;
      this.col[i3 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * u;
      this.col[i3 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * u;
      this.size[i] = this.size0[i] * (1 + (this.params[i * 4 + 2] - 1) * u);
      // Quick fade in, long fade out.
      const fade = Math.min(1, u * 8) * (1 - u * u);
      this.alpha[i] = fade * this.params[i * 4 + 3];
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

function randomInSphere(): [number, number, number] {
  for (;;) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    if (x * x + y * y + z * z <= 1) return [x, y, z];
  }
}

// A pair of systems (glowing additive + soft normal) shared by the stage and locations.
export class Particles {
  readonly glow = new ParticleSystem(6000, true);
  readonly soft = new ParticleSystem(2500, false);

  addTo(scene: THREE.Scene): void {
    scene.add(this.glow.points, this.soft.points);
  }
  update(dt: number): void {
    this.glow.update(dt);
    this.soft.update(dt);
  }
  setViewportHeight(h: number): void {
    this.glow.setViewportHeight(h);
    this.soft.setViewportHeight(h);
  }
  clear(): void {
    this.glow.clear();
    this.soft.clear();
  }
}

// Helpers for common emitters.
export const hdr = (hex: string, intensity: number) => new THREE.Color(hex).multiplyScalar(intensity);

export function flame(p: Particles, at: THREE.Vector3, scale = 1, color = "#ff8a2a", dt = 1 / 60) {
  const n = Math.max(1, Math.round(60 * dt * 1.4 * scale));
  p.glow.emit({
    count: n,
    at,
    spread: 0.04 * scale,
    velocity: new THREE.Vector3(0, 0.55 * scale, 0),
    jitter: 0.12 * scale,
    life: [0.25, 0.55],
    size: [0.12 * scale, 0.22 * scale],
    color: hdr(color, 3.2),
    colorEnd: hdr("#a01800", 0.6),
    grow: 0.25,
  });
}
