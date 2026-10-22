export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Frame-rate independent exponential smoothing factor.
export const dampFactor = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, dampFactor(lambda, dt));

// Shortest signed difference between two angles.
export const angleDelta = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const dampAngle = (a: number, b: number, lambda: number, dt: number) =>
  a + angleDelta(a, b) * dampFactor(lambda, dt);

// Envelope for a clip: fades in over `fin` and out over `fout` of normalized time.
export const envelope = (u: number, fin = 0.15, fout = 0.15, hold = false) => {
  if (u < fin) return smoothstep(u / fin);
  if (hold || u <= 1 - fout) return 1;
  return smoothstep((1 - u) / fout);
};

// Deterministic PRNG so procedural assets look the same every load.
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

// Cheap smooth 1D noise in [-1, 1].
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}
