// Generic procedural scene builder: reads a location config (colors + primitive
// props) plus an optional list of chapter entities (characters/objects) and
// constructs a minimal Three.js scene. No external model files needed.

function humanize(id) {
  if (!id) return "Unknown";
  return id
    .toString()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function addPrimitive(THREE, scene, prop) {
  let geometry;
  if (prop.type === "box") {
    geometry = new THREE.BoxGeometry(...prop.size);
  } else if (prop.type === "sphere") {
    geometry = new THREE.SphereGeometry(prop.radius, 16, 16);
  } else if (prop.type === "cylinder") {
    geometry = new THREE.CylinderGeometry(...prop.radius);
  } else if (prop.type === "torus") {
    geometry = new THREE.TorusGeometry(prop.radius[0], prop.radius[1], 12, 24);
  } else {
    return null;
  }
  const material = new THREE.MeshStandardMaterial({
    color: prop.color || "#cccccc",
    wireframe: !!prop.wireframe,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...prop.pos);
  mesh.userData.label = humanize(prop.id || prop.type);
  scene.add(mesh);
  return mesh;
}

function buildCharacter(THREE, def, scale, id) {
  const group = new THREE.Group();
  group.userData.label = humanize(id);
  const color = def.color || "#888888";
  const s = (def.scale || 1) * (scale || 1);
  const material = new THREE.MeshStandardMaterial({ color });

  if (def.shape === "bird") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.15 * s, 8, 8), material);
    body.position.y = 0.15 * s;
    group.add(body);
    const wingMat = new THREE.MeshStandardMaterial({ color: def.accent || color });
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.05 * s, 0.15 * s), wingMat);
    wing.position.y = 0.18 * s;
    group.add(wing);
  } else if (def.shape === "cat") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 8, 8), material);
    body.position.y = 0.18 * s;
    group.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.3 * s), material);
    tail.position.set(0.2 * s, 0.2 * s, 0);
    tail.rotation.z = Math.PI / 4;
    group.add(tail);
  } else if (def.shape === "beast" || def.shape === "beast_large") {
    const scaleMul = def.shape === "beast_large" ? 1.8 : 1;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.2 * s * scaleMul, 0.7 * s * scaleMul, 0.5 * s * scaleMul),
      material
    );
    body.position.y = 0.6 * s * scaleMul;
    group.add(body);
    const legPositions = [
      [0.4, -0.15, 0.15], [0.4, -0.15, -0.15],
      [-0.4, -0.15, 0.15], [-0.4, -0.15, -0.15],
    ];
    legPositions.forEach(([x, y, z]) => {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08 * s * scaleMul, 0.08 * s * scaleMul, 0.5 * s * scaleMul),
        material
      );
      leg.position.set(x * s * scaleMul, 0.35 * s * scaleMul, z * s * scaleMul);
      group.add(leg);
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25 * s * scaleMul, 8, 8), material);
    head.position.set(0.7 * s * scaleMul, 0.9 * s * scaleMul, 0);
    group.add(head);
  } else if (def.shape === "centaur") {
    const horseBody = new THREE.Mesh(new THREE.BoxGeometry(1.1 * s, 0.6 * s, 0.5 * s), material);
    horseBody.position.y = 0.7 * s;
    group.add(horseBody);
    [[0.35, 0.15], [0.35, -0.15], [-0.35, 0.15], [-0.35, -0.15]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.07 * s, 0.6 * s), material);
      leg.position.set(x * s, 0.4 * s, z * s);
      group.add(leg);
    });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.2 * s, 0.7 * s), material);
    torso.position.set(-0.4 * s, 1.3 * s, 0);
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 8, 8), material);
    head.position.set(-0.4 * s, 1.75 * s, 0);
    group.add(head);
  } else {
    // default: detailed humanoid person with distinguishing facial features
    const skinColor = def.skin || def.accent || "#e8c9a0";
    const hairColor = def.hair || "#3a2a1a";
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor });
    const headY = 1.45 * s;
    const headR = 0.18 * s;

    // legs (two, separated)
    [-0.09, 0.09].forEach((x) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * s, 0.09 * s, 0.6 * s), material);
      leg.position.set(x * s, 0.3 * s, 0);
      group.add(leg);
    });

    // torso (robe)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.25 * s, 0.7 * s, 12), material);
    torso.position.y = 0.95 * s;
    group.add(torso);

    // arms
    [-0.28, 0.28].forEach((x) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * s, 0.06 * s, 0.55 * s), material);
      arm.position.set(x * s, 0.95 * s, 0);
      arm.rotation.z = x < 0 ? 0.12 : -0.12;
      group.add(arm);
    });

    // neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.08 * s, 0.12 * s), skinMat);
    neck.position.y = 1.32 * s;
    group.add(neck);

    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 16), skinMat);
    head.position.y = headY;
    group.add(head);

    // nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, 0.08 * s, 8), skinMat);
    nose.position.set(0, headY - 0.01 * s, headR * 0.92);
    nose.rotation.x = Math.PI / 2;
    group.add(nose);

    // hair
    if (!def.bald) {
      if (def.hairBushy) {
        const bush = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.28, 12, 10), hairMat);
        bush.position.y = headY + 0.02 * s;
        group.add(bush);
      } else {
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(headR * 1.06, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
          hairMat
        );
        cap.position.y = headY + 0.01 * s;
        group.add(cap);
      }
      if (def.hairLong) {
        [-1, 1].forEach((side) => {
          const strand = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05 * s, 0.04 * s, 0.5 * s, 8),
            hairMat
          );
          strand.position.set(side * headR * 0.85, headY - 0.15 * s, -0.03 * s);
          group.add(strand);
        });
      }
      if (def.hairBun) {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07 * s, 10, 8), hairMat);
        bun.position.set(0, headY + 0.14 * s, -headR * 0.7);
        group.add(bun);
      }
    }

    // glasses
    if (def.glasses) {
      const glassMat = new THREE.MeshStandardMaterial({ color: "#1a1a1a" });
      const lensY = def.glasses === "halfmoon" ? headY - 0.05 * s : headY + 0.01 * s;
      const lensZ = headR * 0.9;
      if (def.glasses === "square") {
        [-0.075, 0.075].forEach((x) => {
          const lens = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 0.06 * s, 0.02 * s), glassMat);
          lens.position.set(x * s, lensY, lensZ);
          group.add(lens);
        });
      } else {
        [-0.075, 0.075].forEach((x) => {
          const lens = new THREE.Mesh(new THREE.TorusGeometry(0.045 * s, 0.008 * s, 8, 16), glassMat);
          lens.position.set(x * s, lensY, lensZ);
          group.add(lens);
        });
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.01 * s, 0.01 * s), glassMat);
      bridge.position.set(0, lensY, lensZ);
      group.add(bridge);
    }

    // beard / mustache
    if (def.beard) {
      const beardLen = def.beardLong ? 0.55 * s : 0.16 * s;
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.11 * s, beardLen, 10), hairMat);
      beard.position.set(0, headY - headR * 0.6 - beardLen / 2, headR * 0.35);
      group.add(beard);
    }
    if (def.mustache) {
      const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.13 * s, 0.03 * s, 0.03 * s), hairMat);
      mustache.position.set(0, headY - 0.05 * s, headR * 0.88);
      group.add(mustache);
    }

    // turban
    if (def.turban) {
      const turbanMat = new THREE.MeshStandardMaterial({ color: "#7a4a9a" });
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.95, 0.06 * s, 8, 16), turbanMat);
      wrap.rotation.x = Math.PI / 2;
      wrap.position.y = headY + 0.06 * s;
      group.add(wrap);
      const top = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.6, 10, 8), turbanMat);
      top.position.y = headY + 0.16 * s;
      group.add(top);
    }

    // lightning-bolt scar
    if (def.scar) {
      const scarMat = new THREE.MeshStandardMaterial({ color: "#8a3a2a" });
      const scar = new THREE.Mesh(new THREE.BoxGeometry(0.015 * s, 0.09 * s, 0.01 * s), scarMat);
      scar.position.set(0.06 * s, headY + 0.08 * s, headR * 0.88);
      scar.rotation.z = 0.5;
      group.add(scar);
    }

    // glowing eyes (voldemort)
    if (def.eyesGlow) {
      const eyeMat = new THREE.MeshStandardMaterial({
        color: def.accent || "#cc0000",
        emissive: def.accent || "#cc0000",
        emissiveIntensity: 0.8,
      });
      [-0.06, 0.06].forEach((x) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 8, 8), eyeMat);
        eye.position.set(x * s, headY + 0.01 * s, headR * 0.92);
        group.add(eye);
      });
    }
  }

  return group;
}

function buildObject(THREE, def, id) {
  const material = new THREE.MeshStandardMaterial({ color: def.color || "#cccccc" });
  const group = new THREE.Group();
  group.userData.label = humanize(id);

  switch (def.shape) {
    case "stick": {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.4), material);
      group.add(m);
      break;
    }
    case "broom": {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8), material);
      group.add(handle);
      const bristles = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.15),
        new THREE.MeshStandardMaterial({ color: "#8a6a3a" })
      );
      bristles.position.y = -0.4;
      group.add(bristles);
      break;
    }
    case "pot": {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.35), material);
      group.add(m);
      break;
    }
    case "bird": {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), material);
      group.add(m);
      break;
    }
    case "egg": {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), material);
      m.scale.set(1, 1.3, 1);
      group.add(m);
      break;
    }
    case "gem": {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), material);
      group.add(m);
      break;
    }
    case "sphere_small": {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), material);
      group.add(m);
      break;
    }
    case "box_small": {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.2), material);
      group.add(m);
      break;
    }
    case "cloth": {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), material);
      group.add(m);
      break;
    }
    case "key": {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3), material);
      group.add(shaft);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 16), material);
      ring.position.y = 0.18;
      group.add(ring);
      break;
    }
    default: {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
      group.add(m);
    }
  }

  return group;
}

function randomInBounds(bounds) {
  const w = (bounds && bounds.width) || 8;
  const d = (bounds && bounds.depth) || 8;
  return {
    x: (Math.random() - 0.5) * w * 0.7,
    z: (Math.random() - 0.5) * d * 0.7,
  };
}

function placeEntities(THREE, scene, bounds, entities, entityDefs) {
  if (!entities || !entityDefs) return;
  scene.userData.entities = scene.userData.entities || {};

  (entities.characters || []).forEach((id) => {
    const def = entityDefs.characters && entityDefs.characters[id];
    if (!def) return;
    const character = buildCharacter(THREE, def, 1, id);
    const { x, z } = randomInBounds(bounds);
    character.position.set(x, 0, z);
    character.userData.basePos = character.position.clone();
    character.userData.baseRot = character.rotation.clone();
    scene.add(character);
    scene.userData.entities[id] = character;
  });

  (entities.objects || []).forEach((id) => {
    const def = entityDefs.objects && entityDefs.objects[id];
    if (!def) return;
    const obj = buildObject(THREE, def, id);
    const { x, z } = randomInBounds(bounds);
    obj.position.set(x, 0.3, z);
    obj.userData.basePos = obj.position.clone();
    obj.userData.baseRot = obj.rotation.clone();
    scene.add(obj);
    scene.userData.entities[id] = obj;
  });
}

// -- Procedural animation clips --------------------------------------
// Each clip animates a character/object group in place using
// requestAnimationFrame, then restores it to its resting pose.
// No skeletal rigging is used since everything is built from primitives.

let THREE_REF = null;

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function animateGroup(group, duration, loop, onFrame, onDone) {
  const start = performance.now();
  function step(now) {
    let t = (now - start) / duration;
    if (loop && t > 1) t = t % 1;
    const done = !loop && t >= 1;
    onFrame(Math.min(t, 1), group);
    if (!done) {
      group.userData._raf = requestAnimationFrame(step);
    } else {
      onFrame(1, group);
      if (onDone) onDone();
    }
  }
  if (group.userData._raf) cancelAnimationFrame(group.userData._raf);
  group.userData._raf = requestAnimationFrame(step);
}

const CLIPS = {
  translate(group, duration, loop, params) {
    const base = group.userData.basePos || group.position.clone();
    const dx = (params && params.dx) || 0;
    const dz = (params && params.dz) || 1.5;
    animateGroup(group, duration, loop, (t) => {
      group.position.x = base.x + dx * t;
      group.position.z = base.z + dz * t;
      group.position.y = base.y + Math.abs(Math.sin(t * Math.PI * 4)) * 0.05;
    }, () => {
      group.userData.basePos = group.position.clone();
    });
  },
  arc_jump(group, duration, loop, params) {
    const base = group.userData.basePos || group.position.clone();
    const height = (params && params.height) || 0.8;
    animateGroup(group, duration, loop, (t) => {
      group.position.y = base.y + Math.sin(t * Math.PI) * height;
      group.position.z = base.z + t * ((params && params.dz) || 1);
    }, () => {
      group.position.y = base.y;
      group.userData.basePos = group.position.clone();
    });
  },
  fall_down(group, duration, loop) {
    const baseRot = group.userData.baseRot || group.rotation.clone();
    animateGroup(group, duration, loop, (t) => {
      group.rotation.z = baseRot.z + easeInOut(t) * (Math.PI / 2);
      group.position.y = Math.max(0, group.userData.basePos.y - t * 0.3);
    }, () => {
      group.rotation.z = baseRot.z;
      group.position.y = group.userData.basePos.y;
    });
  },
  crouch_dip(group, duration, loop) {
    const baseY = group.userData.basePos.y;
    animateGroup(group, duration, loop, (t) => {
      const dip = Math.sin(t * Math.PI);
      group.scale.y = 1 - dip * 0.3;
      group.position.y = baseY - dip * 0.15;
    }, () => {
      group.scale.y = 1;
      group.position.y = baseY;
    });
  },
  float_bob(group, duration, loop) {
    const baseY = group.userData.basePos.y + 1.2;
    animateGroup(group, duration, loop, (t) => {
      group.position.y = baseY + Math.sin(t * Math.PI * 2) * 0.15;
    });
  },
  lower_pose(group, duration, loop) {
    const baseY = group.userData.basePos.y;
    animateGroup(group, duration, loop, (t) => {
      group.scale.y = 1 - easeInOut(t) * 0.45;
      group.position.y = baseY;
    });
  },
  rise_pose(group, duration, loop) {
    animateGroup(group, duration, loop, (t) => {
      group.scale.y = 0.55 + easeInOut(t) * 0.45;
    }, () => {
      group.scale.y = 1;
    });
  },
  tilt_pose(group, duration, loop) {
    const baseRot = group.userData.baseRot || group.rotation.clone();
    animateGroup(group, duration, loop, (t) => {
      group.rotation.z = baseRot.z + Math.sin(t * Math.PI) * 0.3;
    }, () => {
      group.rotation.z = baseRot.z;
    });
  },
  hold_still(group, duration, loop) {
    animateGroup(group, duration, loop, () => {});
  },
  jitter(group, duration, loop) {
    const base = group.userData.basePos || group.position.clone();
    animateGroup(group, duration, loop, (t) => {
      group.position.x = base.x + (Math.random() - 0.5) * 0.05;
      group.position.z = base.z + (Math.random() - 0.5) * 0.05;
    }, () => {
      group.position.x = base.x;
      group.position.z = base.z;
    });
  },
  arm_gesture(group, duration, loop) {
    const baseRot = group.userData.baseRot || group.rotation.clone();
    animateGroup(group, duration, loop, (t) => {
      group.rotation.y = baseRot.y + Math.sin(t * Math.PI * 2) * 0.25;
    }, () => {
      group.rotation.y = baseRot.y;
    });
  },
  wand_cast(group, duration, loop) {
    const baseScale = 1;
    animateGroup(group, duration, loop, (t) => {
      const pulse = 1 + Math.sin(t * Math.PI) * 0.15;
      group.scale.set(pulse, baseScale + Math.sin(t * Math.PI) * 0.1, pulse);
    }, () => {
      group.scale.set(1, 1, 1);
    });
  },
  attack_lunge(group, duration, loop, params) {
    const base = group.userData.basePos || group.position.clone();
    animateGroup(group, duration, loop, (t) => {
      const lunge = Math.sin(t * Math.PI);
      group.position.z = base.z + lunge * ((params && params.reach) || 0.4);
    }, () => {
      group.position.z = base.z;
    });
  },
  face_pulse(group, duration, loop) {
    animateGroup(group, duration, loop, (t) => {
      const s = 1 + Math.sin(t * Math.PI) * 0.1;
      group.scale.x = s;
    }, () => {
      group.scale.x = 1;
    });
  },
  color_shift(group, duration, loop, params) {
    const targetColor = (params && params.color) || "#ff9999";
    const original = [];
    group.traverse((child) => {
      if (child.material && child.material.color) {
        original.push([child.material, child.material.color.clone()]);
      }
    });
    const target = new THREE_REF.Color(targetColor);
    animateGroup(group, duration, loop, (t) => {
      const amt = Math.sin(t * Math.PI);
      original.forEach(([mat, base]) => {
        mat.color.copy(base).lerp(target, amt * 0.6);
      });
    }, () => {
      original.forEach(([mat, base]) => mat.color.copy(base));
    });
  },
  bob_shake(group, duration, loop) {
    const base = group.userData.basePos || group.position.clone();
    animateGroup(group, duration, loop, (t) => {
      group.position.y = base.y + Math.abs(Math.sin(t * Math.PI * 6)) * 0.08;
    }, () => {
      group.position.y = base.y;
    });
  },
  head_bob(group, duration, loop) {
    const baseRot = group.userData.baseRot || group.rotation.clone();
    animateGroup(group, duration, loop, (t) => {
      group.rotation.x = baseRot.x + Math.sin(t * Math.PI * 4) * 0.08;
    }, () => {
      group.rotation.x = baseRot.x;
    });
  },
  head_turn(group, duration, loop, params) {
    const baseRot = group.userData.baseRot || group.rotation.clone();
    const amount = (params && params.angle) || 0.5;
    animateGroup(group, duration, loop, (t) => {
      group.rotation.y = baseRot.y + Math.sin(t * Math.PI) * amount;
    }, () => {
      group.rotation.y = baseRot.y;
    });
  },
  stretch_pose(group, duration, loop) {
    animateGroup(group, duration, loop, (t) => {
      group.scale.y = 1 + Math.sin(t * Math.PI) * 0.15;
    }, () => {
      group.scale.y = 1;
    });
  },
};

// Public entry point: run an action from actions.json against a placed
// entity. `action` = { character, clip, duration_ms, loop, ...params }
function playAction(scene, action) {
  if (!scene.userData.entities) return false;
  const group = scene.userData.entities[action.character];
  const clipFn = CLIPS[action.clip];
  if (!group || !clipFn) return false;
  clipFn(group, action.duration_ms || 500, !!action.loop, action);
  return true;
}

function buildCrowd(THREE, scene, crowdConfig) {
  if (!crowdConfig) return;
  const { count, xRange, zRange, y, colors } = crowdConfig;
  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length];
    const person = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 6, 6),
      new THREE.MeshStandardMaterial({ color })
    );
    const x = xRange[0] + Math.random() * (xRange[1] - xRange[0]);
    const z = zRange[0] + Math.random() * (zRange[1] - zRange[0]);
    person.position.set(x, y, z);
    person.userData.label = "Spectator";
    scene.add(person);
  }
}

function setupHoverLabels(THREE, container, renderer, scene, camera) {
  const tooltip = document.createElement("div");
  tooltip.style.cssText =
    "position:absolute;pointer-events:none;background:rgba(0,0,0,0.8);" +
    "color:#fff;padding:3px 8px;border-radius:4px;font-size:12px;" +
    "font-family:system-ui,sans-serif;display:none;z-index:10;white-space:nowrap;";
  container.style.position = "relative";
  container.appendChild(tooltip);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function findLabel(object) {
    let current = object;
    while (current) {
      if (current.userData && current.userData.label) return current.userData.label;
      current = current.parent;
    }
    return null;
  }

  renderer.domElement.addEventListener("mousemove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    let label = null;
    for (const hit of intersects) {
      label = findLabel(hit.object);
      if (label) break;
    }

    if (label) {
      tooltip.textContent = label;
      tooltip.style.left = event.clientX - rect.left + 12 + "px";
      tooltip.style.top = event.clientY - rect.top + 12 + "px";
      tooltip.style.display = "block";
    } else {
      tooltip.style.display = "none";
    }
  });

  renderer.domElement.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}

// -- Speech bubbles ----------------------------------------------------
// Renders a floating text box above a character's head by projecting
// their 3D position to 2D screen space each frame and positioning an
// HTML overlay div there.

function showSpeech(scene, characterId, text, duration) {
  const layer = scene.userData._speechLayer;
  const group = scene.userData.entities && scene.userData.entities[characterId];
  if (!layer || !group) return false;

  scene.userData._speechBubbles = scene.userData._speechBubbles || [];

  let bubble = scene.userData._speechBubbles.find((b) => b.group === group);
  if (!bubble) {
    const div = document.createElement("div");
    div.style.cssText =
      "position:absolute;pointer-events:none;background:#fff;color:#111;" +
      "padding:5px 10px;border-radius:8px;font-size:12px;font-family:system-ui,sans-serif;" +
      "max-width:180px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);" +
      "transform:translate(-50%,-100%);white-space:normal;line-height:1.3;z-index:20;";
    const arrow = document.createElement("div");
    arrow.style.cssText =
      "position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);" +
      "border-left:6px solid transparent;border-right:6px solid transparent;" +
      "border-top:6px solid #fff;";
    div.appendChild(arrow);
    layer.appendChild(div);
    bubble = { group, div, textNode: null };
    scene.userData._speechBubbles.push(bubble);
  }

  if (!bubble.textNode) {
    bubble.textNode = document.createTextNode("");
    bubble.div.insertBefore(bubble.textNode, bubble.div.firstChild);
  }
  bubble.textNode.textContent = text;
  bubble.div.style.display = "block";
  bubble.expireAt = performance.now() + (duration || 3500);
  return true;
}

function updateSpeechBubbles(scene, camera, container) {
  const bubbles = scene.userData._speechBubbles;
  if (!bubbles || !bubbles.length) return;
  const now = performance.now();
  const vector = new THREE_REF.Vector3();

  for (let i = bubbles.length - 1; i >= 0; i--) {
    const bubble = bubbles[i];
    if (now > bubble.expireAt) {
      bubble.div.remove();
      bubbles.splice(i, 1);
      continue;
    }
    vector.setFromMatrixPosition(bubble.group.matrixWorld);
    vector.y += 2.1;
    vector.project(camera);
    const x = (vector.x * 0.5 + 0.5) * container.clientWidth;
    const y = (-vector.y * 0.5 + 0.5) * container.clientHeight;
    bubble.div.style.left = x + "px";
    bubble.div.style.top = y + "px";
    bubble.div.style.display = vector.z > 1 ? "none" : "block";
  }
}

function buildLocationScene(THREE, container, config, entities, entityDefs) {
  THREE_REF = THREE;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.sky || "#87ceeb");

  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.5,
    150
  );
  camera.position.set(8, 6, 12);
  camera.lookAt(0, 1, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.innerHTML = "";
  container.style.position = "relative";
  container.appendChild(renderer.domElement);

  const speechLayer = document.createElement("div");
  speechLayer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;";
  container.appendChild(speechLayer);
  scene.userData._speechLayer = speechLayer;
  scene.userData._speechBubbles = [];

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 10, 5);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: config.ground || "#3c8f3c" })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  (config.props || []).forEach((prop) => addPrimitive(THREE, scene, prop));

  buildCrowd(THREE, scene, config.crowd);
  placeEntities(THREE, scene, config.bounds, entities, entityDefs);

  setupHoverLabels(THREE, container, renderer, scene, camera);

  function animate() {
    requestAnimationFrame(animate);
    scene.rotation.y += 0.002;
    scene.updateMatrixWorld(true);
    updateSpeechBubbles(scene, camera, container);
    renderer.render(scene, camera);
  }
  animate();

  return { scene, camera, renderer };
}
