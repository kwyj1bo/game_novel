import * as THREE from "three";
import type { BuiltModel, JointPose, ModelPart, PartsModel, Rig } from "../story/schema";

// Models the studio's model writes: shapes on a skeleton, and keyframe clips
// in plain joint terms ("right_arm raise 80") that become bone rotations.

// Joints of the humanoid skeleton: parent, rest offset from the parent (as a
// fraction of height; x is the character's left), and the bone name hands
// and heads are found by.
export const JOINTS: Record<string, { parent: string | null; at: [number, number, number]; bone: string }> = {
  hips: { parent: null, at: [0, 0.53, 0], bone: "Hips" },
  spine: { parent: "hips", at: [0, 0.06, 0], bone: "Spine" },
  chest: { parent: "spine", at: [0, 0.12, 0], bone: "Chest" },
  neck: { parent: "chest", at: [0, 0.14, 0], bone: "Neck" },
  head: { parent: "neck", at: [0, 0.05, 0], bone: "Head" },
  left_arm: { parent: "chest", at: [0.12, 0.11, 0], bone: "LeftArm" },
  left_forearm: { parent: "left_arm", at: [0, -0.18, 0], bone: "LeftForeArm" },
  left_hand: { parent: "left_forearm", at: [0, -0.16, 0], bone: "LeftHand" },
  right_arm: { parent: "chest", at: [-0.12, 0.11, 0], bone: "RightArm" },
  right_forearm: { parent: "right_arm", at: [0, -0.18, 0], bone: "RightForeArm" },
  right_hand: { parent: "right_forearm", at: [0, -0.16, 0], bone: "RightHand" },
  left_leg: { parent: "hips", at: [0.06, -0.02, 0], bone: "LeftUpLeg" },
  left_shin: { parent: "left_leg", at: [0, -0.24, 0], bone: "LeftLeg" },
  left_foot: { parent: "left_shin", at: [0, -0.25, 0], bone: "LeftFoot" },
  right_leg: { parent: "hips", at: [-0.06, -0.02, 0], bone: "RightUpLeg" },
  right_shin: { parent: "right_leg", at: [0, -0.24, 0], bone: "RightLeg" },
  right_foot: { parent: "right_shin", at: [0, -0.25, 0], bone: "RightFoot" },
};

const D = Math.PI / 180;

// Plain controls -> Euler angles (radians) in the joint's frame. The figure
// faces +z; x is its left. Signs are mirrored for the right side so "raise"
// and "spread" mean the same on both arms.
export function jointEuler(joint: string, p: JointPose): THREE.Euler {
  const right = joint.startsWith("right_") ? -1 : 1;
  const v = (k: keyof JointPose) => (p[k] ?? 0) * D;
  if (joint.endsWith("_arm")) return new THREE.Euler(-v("raise"), v("twist") * right, v("spread") * right, "ZXY");
  if (joint.endsWith("_forearm")) return new THREE.Euler(-v("bend"), v("twist") * right, 0);
  if (joint.endsWith("_hand")) return new THREE.Euler(-v("bend"), v("twist") * right, 0);
  if (joint.endsWith("_leg")) return new THREE.Euler(-v("lift"), 0, v("spread") * right, "ZXY");
  if (joint.endsWith("_shin")) return new THREE.Euler(v("bend"), 0, 0);
  if (joint.endsWith("_foot")) return new THREE.Euler(v("bend"), 0, 0);
  if (joint === "head" || joint === "neck") return new THREE.Euler(v("nod"), v("turn"), -v("tilt"), "YXZ");
  // hips, spine, chest
  return new THREE.Euler(v("bend"), v("turn"), -v("lean"), "YXZ");
}

export interface BuiltRig {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
}

// The skeleton, scaled to the character's height and build, with its parts
// attached to the joints.
export function buildRig(rig: Rig, parts: ModelPart[]): BuiltRig {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  const h = rig.height;
  const scale: Record<string, [number, number, number]> = {
    left_arm: [rig.shoulders, 1, 1],
    right_arm: [rig.shoulders, 1, 1],
    left_leg: [rig.hips, 1, 1],
    right_leg: [rig.hips, 1, 1],
    left_forearm: [1, rig.arms, 1],
    right_forearm: [1, rig.arms, 1],
    left_hand: [1, rig.arms, 1],
    right_hand: [1, rig.arms, 1],
    left_shin: [1, rig.legs, 1],
    right_shin: [1, rig.legs, 1],
    left_foot: [1, rig.legs, 1],
    right_foot: [1, rig.legs, 1],
  };
  for (const [name, j] of Object.entries(JOINTS)) {
    const b = new THREE.Bone();
    b.name = j.bone;
    const s = scale[name] ?? [1, 1, 1];
    b.position.set(j.at[0] * h * s[0], j.at[1] * h * s[1], j.at[2] * h * s[2]);
    bones.set(name, b);
    (j.parent ? bones.get(j.parent)! : root).add(b);
  }
  // Long legs lift the hips: keep the feet on the floor.
  bones.get("hips")!.position.y = h * (0.53 - (1 - rig.legs) * 0.49);
  for (const p of parts) (p.joint === "root" ? root : bones.get(p.joint) ?? root).add(shape(p));
  return { root, bones };
}

// A shape in metres, offset and turned in its joint's frame.
export function shape(p: ModelPart): THREE.Mesh {
  const [x, y, z] = p.size;
  const geo =
    p.shape === "box" ? new THREE.BoxGeometry(x, y, z)
    : p.shape === "sphere" ? new THREE.SphereGeometry(0.5, 20, 14).scale(x, y, z)
    : p.shape === "capsule" ? new THREE.CapsuleGeometry(0.5, 1, 6, 14).scale(x, y / 2, z)
    : p.shape === "cylinder" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 18).scale(x, y, z)
    : p.shape === "cone" ? new THREE.ConeGeometry(0.5, 1, 18).scale(x, y, z)
    : new THREE.TorusGeometry(0.5, 0.15, 10, 24).scale(x, y, z);
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: p.roughness ?? 0.8,
    metalness: p.metal ?? 0,
    emissive: p.glow ? new THREE.Color(p.color) : new THREE.Color("#000000"),
    emissiveIntensity: p.glow ? 0.8 : 0,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...p.offset);
  m.rotation.set(p.rotation[0] * D, p.rotation[1] * D, p.rotation[2] * D);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A prop or set piece: shapes around one origin.
export function buildParts(model: PartsModel): THREE.Group {
  const g = new THREE.Group();
  for (const p of model.parts) g.add(shape(p));
  return g;
}

// A clip written as keyframes of joint controls -> a three.js clip on the bones.
export function buildClip(name: string, clip: BuiltModel["clips"][string], hipsY: number): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const joints = new Set(clip.keys.flatMap((k) => Object.keys(k.joints)));
  for (const joint of joints) {
    const j = JOINTS[joint];
    if (!j) continue;
    const times: number[] = [];
    const values: number[] = [];
    const q = new THREE.Quaternion();
    for (const k of clip.keys) {
      if (!(joint in k.joints)) continue;
      times.push(k.t);
      q.setFromEuler(jointEuler(joint, k.joints[joint]));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${j.bone}.quaternion`, times, values));
  }
  const drops = clip.keys.filter((k) => k.drop !== undefined);
  if (drops.length) {
    // Crouching and kneeling lower the hips (metres).
    tracks.push(new THREE.NumberKeyframeTrack("Hips.position[y]", drops.map((k) => k.t), drops.map((k) => hipsY - (k.drop ?? 0))));
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}
