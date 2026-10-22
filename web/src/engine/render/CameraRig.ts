import * as THREE from "three";
import type { CameraShot } from "../story/schema";
import { clamp, easeInOutCubic, noise1 } from "../core/math";

export interface ShotSubject {
  // Head (or focus) point in world space.
  point: THREE.Vector3;
  // Facing direction (yaw) when the subject is an actor.
  yaw?: number;
  height?: number;
}

export interface ShotRequest {
  shot: CameraShot;
  subject?: ShotSubject;
  other?: ShotSubject;
  wide: { pos: THREE.Vector3; look: THREE.Vector3 };
}

const UP = new THREE.Vector3(0, 1, 0);

// Cinematic camera: computes framing for named shots, blends between them,
// and layers handheld sway and shake on top.
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(0, 2, 6);
  private look = new THREE.Vector3(0, 1.4, 0);
  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  private toPos = new THREE.Vector3();
  private toLook = new THREE.Vector3();
  private t = 1;
  private dur = 0;
  private resolve: (() => void) | null = null;
  private orbit: { center: THREE.Vector3; radius: number; height: number; angle: number } | null = null;
  private track: { subject: ShotSubject; offset: THREE.Vector3 } | null = null;
  private shakeAmt = 0;
  private shakeLeft = 0;
  private time = 0;
  bounds: THREE.Box3 | null = null;
  handheld = 1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.05, 200);
  }

  cut(pos: THREE.Vector3, look: THREE.Vector3): void {
    this.finish();
    this.orbit = null;
    this.track = null;
    this.pos.copy(pos);
    this.look.copy(look);
    this.toPos.copy(pos);
    this.toLook.copy(look);
    this.t = 1;
  }

  // Frames a shot. ms = 0 cuts; otherwise eases from the current framing.
  frame(req: ShotRequest, ms: number): Promise<void> {
    const { pos, look } = this.compute(req);
    this.orbit = null;
    this.track = null;
    if (req.shot === "orbit" && req.subject) {
      const c = req.subject.point.clone();
      const d = pos.clone().sub(c);
      this.orbit = { center: c, radius: Math.hypot(d.x, d.z), height: d.y, angle: Math.atan2(d.x, d.z) };
    }
    this.finish();
    if (ms <= 0) {
      this.pos.copy(pos);
      this.look.copy(look);
      this.toPos.copy(pos);
      this.toLook.copy(look);
      this.t = 1;
      return Promise.resolve();
    }
    this.fromPos.copy(this.pos);
    this.fromLook.copy(this.look);
    this.toPos.copy(pos);
    this.toLook.copy(look);
    this.t = 0;
    this.dur = ms / 1000;
    return new Promise((r) => (this.resolve = r));
  }

  // Keeps the camera following a moving subject at its current offset.
  follow(subject: ShotSubject): void {
    this.track = { subject, offset: this.toPos.clone().sub(subject.point) };
  }

  private finish(): void {
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r();
    }
  }

  shake(amount: number, seconds: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeLeft = Math.max(this.shakeLeft, seconds);
  }

  private compute(req: ShotRequest): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const s = req.subject;
    if (req.shot === "wide" || !s) {
      return { pos: req.wide.pos.clone(), look: s ? s.point.clone().lerp(req.wide.look, 0.3) : req.wide.look.clone() };
    }
    const h = s.height ?? 1.6;
    const scale = clamp(h / 1.6, 0.8, 3);
    const fwd = new THREE.Vector3(Math.sin(s.yaw ?? 0), 0, Math.cos(s.yaw ?? 0));
    // Without a known facing, frame from the side of the current camera.
    if (s.yaw === undefined) fwd.copy(this.pos).sub(s.point).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const p = s.point;

    switch (req.shot) {
      case "close": {
        const pos = p.clone().addScaledVector(fwd, 1.05 * scale).addScaledVector(right, 0.32 * scale).add(new THREE.Vector3(0, 0.04, 0));
        return { pos, look: p.clone().add(new THREE.Vector3(0, -0.03 * scale, 0)) };
      }
      case "medium": {
        const pos = p.clone().addScaledVector(fwd, 2.3 * scale).addScaledVector(right, 0.6 * scale).add(new THREE.Vector3(0, -0.05, 0));
        return { pos, look: p.clone().add(new THREE.Vector3(0, -0.3 * scale, 0)) };
      }
      case "two": {
        const o = req.other?.point ?? p.clone().addScaledVector(fwd, 1);
        const mid = p.clone().add(o).multiplyScalar(0.5);
        const axis = o.clone().sub(p).setY(0);
        const sep = Math.max(0.8, axis.length());
        const perp = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
        // Stay on the side of the line the camera is already on (180° rule).
        if (perp.dot(this.pos.clone().sub(mid)) < 0) perp.negate();
        const pos = mid.clone().addScaledVector(perp, sep * 1.1 + 1.6 * scale).add(new THREE.Vector3(0, 0.15, 0));
        return { pos, look: mid.clone().add(new THREE.Vector3(0, -0.15, 0)) };
      }
      case "over": {
        const o = req.other?.point ?? p.clone().addScaledVector(fwd, 2);
        const dir = o.clone().sub(p).setY(0).normalize();
        const r = new THREE.Vector3().crossVectors(dir, UP).normalize();
        const pos = p.clone().addScaledVector(dir, -0.85 * scale).addScaledVector(r, 0.42 * scale).add(new THREE.Vector3(0, 0.12 * scale, 0));
        return { pos, look: o.clone() };
      }
      case "low": {
        const pos = p.clone().addScaledVector(fwd, 2.4 * scale).addScaledVector(right, 0.5 * scale);
        pos.y = 0.35;
        return { pos, look: p.clone().add(new THREE.Vector3(0, 0.15 * scale, 0)) };
      }
      case "high": {
        const pos = p.clone().addScaledVector(fwd, 2.2 * scale).add(new THREE.Vector3(0, 3.2 * scale, 0));
        return { pos, look: p.clone().add(new THREE.Vector3(0, -0.8 * scale, 0)) };
      }
      case "orbit": {
        const pos = p.clone().addScaledVector(fwd, 3.4 * scale).add(new THREE.Vector3(0, 0.5 * scale, 0));
        return { pos, look: p.clone() };
      }
      case "pov": {
        const target = req.other?.point ?? p.clone().addScaledVector(fwd, 3);
        return { pos: p.clone().addScaledVector(fwd, 0.15), look: target };
      }
      default:
        return { pos: req.wide.pos.clone(), look: req.wide.look.clone() };
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = easeInOutCubic(this.t);
      this.pos.lerpVectors(this.fromPos, this.toPos, e);
      this.look.lerpVectors(this.fromLook, this.toLook, e);
      if (this.t >= 1) this.finish();
    } else if (this.orbit) {
      const o = this.orbit;
      o.angle += dt * 0.18;
      this.pos.set(o.center.x + Math.sin(o.angle) * o.radius, o.center.y + o.height, o.center.z + Math.cos(o.angle) * o.radius);
      this.look.copy(o.center);
    } else if (this.track) {
      const target = this.track.subject.point.clone().add(this.track.offset);
      this.pos.lerp(target, 1 - Math.exp(-3 * dt));
      this.look.lerp(this.track.subject.point, 1 - Math.exp(-4 * dt));
    }

    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.bounds) cam.position.clamp(this.bounds.min, this.bounds.max);
    // Handheld: slow, small drift of the aim point.
    const hh = 0.012 * this.handheld;
    const lx = noise1(this.time * 0.45, 1) * hh;
    const ly = noise1(this.time * 0.4, 2) * hh;
    let sx = 0;
    let sy = 0;
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const a = this.shakeAmt * Math.min(1, this.shakeLeft * 2);
      sx = noise1(this.time * 25, 3) * a;
      sy = noise1(this.time * 25, 4) * a;
      if (this.shakeLeft <= 0) this.shakeAmt = 0;
    }
    cam.position.x += sx;
    cam.position.y += sy;
    const dist = cam.position.distanceTo(this.look);
    cam.lookAt(this.look.x + lx * dist + sx, this.look.y + ly * dist + sy, this.look.z);
  }

  get focusDistance(): number {
    return this.camera.position.distanceTo(this.look);
  }
}
