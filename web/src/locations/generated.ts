import * as THREE from "three";
import { loadGltf } from "../engine/actors/GltfActor";
import type { GeneratedSet } from "../engine/story/schema";
import type { LocationDef } from "../engine/world/Location";
import { AUTO_MARKS, autoMarks, v3 } from "./kit";

const WALL_HEIGHT = 4;
const LIGHT = {
  day: { sky: "#9fc4e8", hemi: 0.9, key: 2.6, keyColor: "#fff4e0", fog: 0.012 },
  dusk: { sky: "#e3a27a", hemi: 0.6, key: 1.6, keyColor: "#ffc89a", fog: 0.02 },
  night: { sky: "#0b1020", hemi: 0.3, key: 0.8, keyColor: "#a8b8ff", fog: 0.035 },
};

// A place made by the studio: a floor and walls (or open sky) in the set
// designer's colours, light for the time of day, and generated pieces at the
// positions the director chose. Pieces appear when their models load.
export function generatedLocation(id: string, title: string, set: GeneratedSet): LocationDef {
  const [w, d] = set.size;
  const wide = set.indoor ? { pos: v3(w * 0.28, 2.4, d / 2 - 0.6), look: v3(-0.3, 1.1, -d * 0.12) } : { pos: v3(3.5, 2.8, 9.5), look: v3(-0.3, 1.2, -1) };
  const entry = set.indoor ? v3(w / 2 - 1, 0, d / 2 - 1.2) : v3(1.5, 0, 8);
  const marks = autoMarks(v3(0, 0, 0), wide.pos, entry, Math.min(1.8, Math.min(w, d) * 0.2));
  return {
    id,
    title,
    info: { marks: [...AUTO_MARKS], props: {}, keywords: [title] },
    build() {
      const look = LIGHT[set.light];
      const root = new THREE.Group();
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(set.indoor ? w : w * 4, set.indoor ? d : d * 4), new THREE.MeshStandardMaterial({ color: set.floor, roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      root.add(floor);
      if (set.indoor) root.add(walls(w, d, set.wall));
      root.add(new THREE.HemisphereLight(look.sky, set.floor, look.hemi));
      const key = new THREE.DirectionalLight(look.keyColor, look.key);
      key.position.set(w * 0.4, 8, d * 0.6);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -w, right: w, top: d, bottom: -d, near: 0.5, far: 40 });
      root.add(key, key.target);
      for (const piece of set.pieces) void addPiece(root, piece);
      const span = set.indoor ? 0 : 30;
      return {
        root,
        marks,
        wide,
        bounds: set.indoor ? new THREE.Box3(v3(-w / 2 + 0.3, 0.3, -d / 2 + 0.3), v3(w / 2 - 0.3, WALL_HEIGHT - 0.2, d / 2 - 0.3)) : new THREE.Box3(v3(-span, 0.3, -span), v3(span, 30, span)),
        background: new THREE.Color(set.indoor ? "#050505" : look.sky),
        fog: new THREE.FogExp2(set.indoor ? "#100c08" : look.sky, look.fog),
        environmentIntensity: set.indoor ? 0.3 : 0.6,
        music: set.light === "night" ? "dread" : "mystery",
        update() {},
        setProp() {},
      };
    },
  };
}

// Back and side walls; the front stays open for the camera.
function walls(w: number, d: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const sides: [number, number, number, number, number][] = [
    [w, 0, -d / 2, 0, 0],
    [d, -w / 2, 0, Math.PI / 2, 0],
    [d, w / 2, 0, -Math.PI / 2, 0],
  ];
  for (const [len, x, z, yaw] of sides) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_HEIGHT), mat);
    wall.position.set(x, WALL_HEIGHT / 2, z);
    wall.rotation.y = yaw;
    wall.receiveShadow = true;
    g.add(wall);
  }
  return g;
}

async function addPiece(root: THREE.Object3D, piece: GeneratedSet["pieces"][number]): Promise<void> {
  const gltf = await loadGltf(piece.url);
  const body = gltf.scene.clone(true);
  const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
  body.scale.setScalar(piece.size / Math.max(0.001, size.x, size.y, size.z));
  body.position.set(piece.at[0], 0, piece.at[1]);
  body.rotation.y = piece.yaw;
  body.userData.shared = true;
  body.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  root.add(body);
}
