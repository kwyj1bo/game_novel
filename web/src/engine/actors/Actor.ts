import * as THREE from "three";
import type { ActorSpec, AnimClip } from "../story/schema";
import { angleDelta, clamp, damp, dampAngle } from "../core/math";

interface ActiveClip {
  name: AnimClip;
  t: number;
  duration: number;
  hold: boolean;
  resolve: () => void;
}

interface Move {
  to: THREE.Vector3;
  speed: number;
  resolve: () => void;
}

const TMP = new THREE.Vector3();

// Shared behaviour for every actor: placement, walking to a point, turning,
// head look-at and a clip player. Subclasses build the mesh and turn the
// state below into a pose each frame.
export abstract class Actor {
  readonly root = new THREE.Group();
  yaw = 0;
  protected targetYaw = 0;
  protected move: Move | null = null;
  // Locomotion speed in m/s, smoothed; drives walk cycles.
  protected speed = 0;
  protected gait = 0;
  protected lookTarget: THREE.Vector3 | null = null;
  protected clip: ActiveClip | null = null;
  // A clip played with hold=true stays applied at its final frame.
  protected held: AnimClip | null = null;
  speaking = false;
  protected time = 0;

  constructor(
    readonly id: string,
    readonly spec: ActorSpec,
  ) {
    this.root.name = id;
  }

  abstract get height(): number;
  protected abstract clipDuration(clip: AnimClip): number;
  protected abstract pose(dt: number): void;
  abstract headPosition(out: THREE.Vector3): THREE.Vector3;
  // Where spells come from.
  abstract castPoint(out: THREE.Vector3): THREE.Vector3;

  // Named attachment points (e.g. "hand_r", "hips"); falls back to the root.
  socket(_name: string): THREE.Object3D {
    return this.root;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  place(p: THREE.Vector3): void {
    this.cancelMove();
    this.root.position.copy(p);
  }

  face(p: THREE.Vector3, instant: boolean): void {
    const dx = p.x - this.root.position.x;
    const dz = p.z - this.root.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.targetYaw = Math.atan2(dx, dz);
    if (instant) this.yaw = this.targetYaw;
  }

  setYaw(yaw: number): void {
    this.yaw = this.targetYaw = yaw;
  }

  lookAt(p: THREE.Vector3 | null): void {
    this.lookTarget = p ? p.clone() : null;
  }

  moveTo(p: THREE.Vector3, run: boolean, instant: boolean): Promise<void> {
    this.cancelMove();
    if (instant) {
      this.face(p, true);
      this.root.position.copy(p);
      return Promise.resolve();
    }
    this.face(p, false);
    return new Promise((resolve) => {
      this.move = { to: p.clone(), speed: run ? this.runSpeed() : this.walkSpeed(), resolve };
    });
  }

  protected walkSpeed(): number {
    return 1.35 * (this.height / 1.6) ** 0.5;
  }
  protected runSpeed(): number {
    return this.walkSpeed() * 2.6;
  }

  private cancelMove(): void {
    if (this.move) {
      const r = this.move.resolve;
      this.move = null;
      r();
    }
  }

  play(name: AnimClip, hold: boolean, instant: boolean): Promise<void> {
    if (this.clip) {
      const r = this.clip.resolve;
      this.clip = null;
      r();
    }
    if (name === "idle") {
      this.held = null;
      return Promise.resolve();
    }
    if (instant) {
      if (hold) this.held = name;
      return Promise.resolve();
    }
    this.held = null;
    return new Promise((resolve) => {
      this.clip = { name, t: 0, duration: this.clipDuration(name), hold, resolve };
    });
  }

  // Normalized progress of the current clip, or 1 for a held clip.
  protected clipState(): { name: AnimClip; u: number; hold: boolean } | null {
    if (this.clip) return { name: this.clip.name, u: clamp(this.clip.t / this.clip.duration, 0, 1), hold: this.clip.hold };
    if (this.held) return { name: this.held, u: 1, hold: true };
    return null;
  }

  update(dt: number): void {
    this.time += dt;
    this.updateMove(dt);
    this.yaw = dampAngle(this.yaw, this.targetYaw, this.move ? 8 : 5, dt);
    this.root.rotation.y = this.yaw;

    if (this.clip) {
      this.clip.t += dt;
      if (this.clip.t >= this.clip.duration) {
        const c = this.clip;
        this.clip = null;
        if (c.hold) this.held = c.name;
        c.resolve();
      }
    }
    this.pose(dt);
  }

  private updateMove(dt: number): void {
    const m = this.move;
    if (!m) {
      this.speed = damp(this.speed, 0, 10, dt);
      return;
    }
    TMP.subVectors(m.to, this.root.position);
    const dist = TMP.length();
    // Turn mostly in place before stepping off when the target is behind.
    const facingError = Math.abs(angleDelta(this.yaw, this.targetYaw));
    const want = facingError > 1.2 ? m.speed * 0.15 : m.speed * Math.min(1, dist / 0.6 + 0.25);
    this.speed = damp(this.speed, want, 6, dt);
    const step = this.speed * dt;
    if (dist <= Math.max(step, 0.02)) {
      this.root.position.copy(m.to);
      this.move = null;
      m.resolve();
      return;
    }
    this.root.position.addScaledVector(TMP.normalize(), step);
    this.face(m.to, false);
    this.gait += step;
  }

  dispose(): void {
    this.cancelMove();
    this.play("idle", false, true);
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
