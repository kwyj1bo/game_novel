import * as THREE from "three";
import type { FxKind } from "../story/schema";
import { easeInOutCubic, lerp } from "../core/math";
import type { Timeline } from "../core/Timeline";
import type { AudioEngine } from "../audio/AudioEngine";
import type { CameraRig } from "../render/CameraRig";
import { hdr, type Particles } from "./Particles";

export interface ResolvedFx {
  from?: THREE.Vector3;
  to?: THREE.Vector3;
  at?: THREE.Vector3;
  color: string;
  ms?: number;
}

// One-shot visual effects. Each returns a promise that resolves when the
// effect has done its job (a spell lands, a fade completes).
export class FxSystem {
  // Fixed pool: adding/removing lights at runtime forces every material to recompile.
  private readonly pool: { light: THREE.PointLight; life: number; max: number; peak: number; follow?: THREE.Object3D }[] = [];
  private readonly emitters: { left: number; fn: (dt: number) => void }[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly particles: Particles,
    private readonly timeline: Timeline,
    private readonly camera: CameraRig,
    private readonly audio: AudioEngine,
    private readonly overlay: HTMLElement,
  ) {
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight("#ffffff", 0, 8, 2);
      this.scene.add(light);
      this.pool.push({ light, life: 0, max: 1, peak: 0 });
    }
  }

  run(kind: FxKind, o: ResolvedFx): Promise<void> {
    const at = o.at ?? o.to ?? o.from ?? new THREE.Vector3();
    switch (kind) {
      case "spell":
        return this.spell(o.from ?? at, o.to ?? at, o.color);
      case "burst":
        this.burst(at, o.color);
        return this.timeline.delay(300);
      case "fire":
        return this.fire(at, o.color, o.ms ?? 2200);
      case "smoke":
        return this.smoke(at, o.ms ?? 2500);
      case "sparkles":
        return this.sparkles(at, o.color, o.ms ?? 2000);
      case "flash":
        return this.flash("#ffffff", o.ms ?? 700);
      case "shake":
        this.camera.shake(0.18, (o.ms ?? 700) / 1000);
        return this.timeline.delay(o.ms ?? 700);
      case "fade_out":
        return this.fade("#000000", 1, o.ms ?? 900);
      case "fade_in":
        return this.fade(null, 0, o.ms ?? 900);
      case "red_out":
        return this.fade("#4a0000", 0.85, o.ms ?? 900);
    }
  }

  private pulseLight(at: THREE.Vector3, color: string, peak: number, seconds: number, distance = 8, follow?: THREE.Object3D): THREE.PointLight {
    const slot = this.pool.reduce((a, b) => (b.life < a.life ? b : a));
    Object.assign(slot, { life: seconds, max: seconds, peak, follow });
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.light.position.copy(at);
    slot.light.intensity = peak;
    return slot.light;
  }

  private every(seconds: number, fn: (dt: number) => void): void {
    this.emitters.push({ left: seconds, fn });
  }

  spell(from: THREE.Vector3, to: THREE.Vector3, color: string): Promise<void> {
    this.audio.sfx("spell");
    const c = new THREE.Color(color);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 8),
      new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(8), toneMapped: false }),
    );
    core.position.copy(from);
    this.scene.add(core);
    const dist = from.distanceTo(to);
    const ms = Math.max(250, (dist / 13) * 1000);
    const light = this.pulseLight(from, color, 8, ms / 1000, 6, core);
    const prev = from.clone();
    return this.timeline
      .tween(ms, (u) => {
        const e = easeInOutCubic(u);
        core.position.lerpVectors(from, to, e);
        core.position.y += Math.sin(u * Math.PI) * dist * 0.05;
        this.particles.glow.emit({
          count: 6,
          at: core.position,
          spread: 0.04,
          velocity: prev.sub(core.position).multiplyScalar(-2),
          jitter: 0.3,
          life: [0.2, 0.5],
          size: [0.04, 0.09],
          color: c.clone().multiplyScalar(5),
          colorEnd: c.clone().multiplyScalar(0.5),
          drag: 2,
        });
        prev.copy(core.position);
      })
      .then(() => {
        light.intensity = 0;
        core.removeFromParent();
        core.geometry.dispose();
        (core.material as THREE.Material).dispose();
        this.burst(to, color);
      });
  }

  burst(at: THREE.Vector3, color: string): void {
    this.audio.sfx("burst");
    const c = new THREE.Color(color);
    this.particles.glow.emit({
      count: 140,
      at,
      spread: 0.05,
      jitter: 4.5,
      life: [0.35, 0.9],
      size: [0.05, 0.13],
      color: c.clone().multiplyScalar(6),
      colorEnd: c.clone().multiplyScalar(0.3),
      drag: 3,
      gravity: 1.5,
    });
    this.pulseLight(at, color, 25, 0.6);
  }

  fire(at: THREE.Vector3, color: string, ms: number): Promise<void> {
    this.audio.sfx("fire");
    const light = this.pulseLight(at.clone().add(new THREE.Vector3(0, 0.6, 0)), color, 30, ms / 1000 + 0.5, 12);
    this.every(ms / 1000, (dt) => {
      light.intensity *= 0.98 + Math.random() * 0.04;
      this.particles.glow.emit({
        count: Math.round(220 * dt * 60) / 60 + 3,
        at,
        spread: 0.5,
        velocity: new THREE.Vector3(0, 1.8, 0),
        jitter: 0.6,
        life: [0.4, 0.9],
        size: [0.25, 0.5],
        color: hdr(color, 3.5),
        colorEnd: hdr("#801000", 0.4),
        grow: 0.3,
      });
    });
    return this.timeline.delay(ms);
  }

  smoke(at: THREE.Vector3, ms: number): Promise<void> {
    this.every(ms / 1000, () => {
      this.particles.soft.emit({
        count: 3,
        at,
        spread: 0.3,
        velocity: new THREE.Vector3(0, 0.6, 0),
        jitter: 0.25,
        life: [1.5, 2.6],
        size: [0.4, 0.7],
        color: new THREE.Color("#5a5650"),
        colorEnd: new THREE.Color("#2a2826"),
        grow: 3,
        alpha: 0.5,
      });
    });
    return this.timeline.delay(ms);
  }

  sparkles(at: THREE.Vector3, color: string, ms: number): Promise<void> {
    this.audio.sfx("sparkle");
    const c = new THREE.Color(color);
    this.every(ms / 1000, () => {
      this.particles.glow.emit({
        count: 2,
        at,
        spread: 0.7,
        velocity: new THREE.Vector3(0, 0.25, 0),
        jitter: 0.2,
        life: [0.6, 1.3],
        size: [0.03, 0.07],
        color: c.clone().multiplyScalar(6),
        colorEnd: c.clone().multiplyScalar(1),
      });
    });
    return this.timeline.delay(ms);
  }

  flash(color: string, ms: number): Promise<void> {
    this.overlay.style.background = color;
    return this.timeline.tween(ms, (u) => {
      this.overlay.style.opacity = String(1 - u);
    });
  }

  fade(color: string | null, target: number, ms: number): Promise<void> {
    if (color) this.overlay.style.background = color;
    const from = Number(this.overlay.style.opacity || 0);
    return this.timeline.tween(ms, (u) => {
      this.overlay.style.opacity = String(lerp(from, target, easeInOutCubic(u)));
    });
  }

  clearOverlay(): void {
    this.overlay.style.opacity = "0";
  }

  update(dt: number): void {
    for (const e of this.emitters) {
      e.left -= dt;
      e.fn(dt);
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) if (this.emitters[i].left <= 0) this.emitters.splice(i, 1);
    for (const l of this.pool) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.follow) l.light.position.copy(l.follow.position);
      l.light.intensity = l.follow ? l.peak : Math.max(0, (l.life / l.max) * l.peak);
      if (l.life <= 0) l.light.intensity = 0;
    }
  }
}
