import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildClip, buildRig, jointEuler } from "../../src/engine/actors/procedural";

const rig = { height: 1.7, shoulders: 1, hips: 1, arms: 1, legs: 1 };

// World position of a joint's bone after posing some joints.
function posed(pose: Record<string, Record<string, number>>, joint: string, rigOverride = rig): THREE.Vector3 {
  const { root, bones } = buildRig(rigOverride, []);
  for (const [j, p] of Object.entries(pose)) bones.get(j)!.quaternion.setFromEuler(jointEuler(j, p));
  root.updateMatrixWorld(true);
  return bones.get(joint)!.getWorldPosition(new THREE.Vector3());
}

describe("built characters", () => {
  it("stands on the floor with arms hanging and the left side at +x", () => {
    const hand = posed({}, "left_hand");
    const foot = posed({}, "left_foot");
    expect(hand.x).toBeGreaterThan(0);
    expect(posed({}, "right_hand").x).toBeLessThan(0);
    expect(foot.y).toBeCloseTo(0.0, 1);
    expect(posed({}, "head").y).toBeGreaterThan(1.4);
  });

  it("raises an arm forward, toward +z, the same way on both sides", () => {
    const rest = posed({}, "right_hand");
    const right = posed({ right_arm: { raise: 90 } }, "right_hand");
    const left = posed({ left_arm: { raise: 90 } }, "left_hand");
    expect(right.z).toBeGreaterThan(rest.z + 0.25);
    expect(left.z).toBeGreaterThan(rest.z + 0.25);
    expect(right.y).toBeGreaterThan(rest.y + 0.25);
  });

  it("spreads each arm out to its own side, and bends the knee backwards", () => {
    expect(posed({ left_arm: { spread: 90 } }, "left_hand").x).toBeGreaterThan(0.4);
    expect(posed({ right_arm: { spread: 90 } }, "right_hand").x).toBeLessThan(-0.4);
    const foot = posed({ right_shin: { bend: 90 } }, "right_foot");
    expect(foot.z).toBeLessThan(-0.2);
  });

  it("bends the elbow up toward the face and nods the head forward", () => {
    const hand = posed({ right_forearm: { bend: 120 } }, "right_hand");
    expect(hand.y).toBeGreaterThan(posed({}, "right_forearm").y - 0.05);
    expect(hand.z).toBeGreaterThan(0.05);
  });

  it("turns keyframes into a clip on the bones", () => {
    const clip = buildClip("wave", { duration: 1, loop: false, keys: [{ t: 0, joints: { right_arm: { spread: 30 } } }, { t: 1, joints: { right_arm: { spread: 160 } }, drop: 0.2 }] }, 0.9);
    expect(clip.tracks.map((t) => t.name).sort()).toEqual(["Hips.position[y]", "RightArm.quaternion"]);
    expect(clip.tracks.find((t) => t.name.startsWith("Hips"))!.values[0]).toBeCloseTo(0.7, 5);
  });
});
