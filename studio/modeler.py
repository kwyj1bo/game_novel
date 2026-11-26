"""The model as 3D modeller and animator, for free.

- Characters: a humanoid skeleton sized by height and build, with shapes
  (box, sphere, capsule, cylinder, cone, torus) attached to its joints: the
  robe on the chest and hips, the beard on the head, the hat, the glasses.
- Props and set pieces: shapes at their real size in metres.
- Clips: keyframes of plain joint controls ("right_arm raise 80, right_forearm
  bend 30 at 0.6 s"); the engine turns them into bone rotations.

Checkers keep every part on a real joint at a sane size, every limb covered,
every angle inside the joint's range and every keyframe in order.
"""

import re

from .llm import B, N, S, Model, arr, obj

JOINTS = ["hips", "spine", "chest", "neck", "head", "left_arm", "left_forearm", "left_hand", "right_arm", "right_forearm", "right_hand",
          "left_leg", "left_shin", "left_foot", "right_leg", "right_shin", "right_foot"]  # fmt: skip
MUST_COVER = ["head", "chest", "hips", "left_arm", "left_forearm", "right_arm", "right_forearm", "left_leg", "left_shin", "right_leg", "right_shin"]
SHAPES = ["box", "sphere", "capsule", "cylinder", "cone", "torus"]
# Controls each joint takes, with their range in degrees.
CONTROLS = {
    "arm": {"raise": (-60, 180), "spread": (-20, 180), "twist": (-90, 90)},
    "forearm": {"bend": (0, 150), "twist": (-90, 90)},
    "hand": {"bend": (-70, 70), "twist": (-90, 90)},
    "leg": {"lift": (-45, 120), "spread": (-20, 60)},
    "shin": {"bend": (0, 150)},
    "foot": {"bend": (-40, 40)},
    "head": {"nod": (-40, 50), "turn": (-80, 80), "tilt": (-35, 35)},
    "trunk": {"bend": (-30, 90), "turn": (-60, 60), "lean": (-30, 30)},
}


def joint_kind(joint: str) -> str:
    for suffix in ("forearm", "arm", "hand", "shin", "leg", "foot"):
        if joint.endswith("_" + suffix):
            return suffix
    return "head" if joint in ("head", "neck") else "trunk"


RIG_NOTES = (
    "The skeleton: the figure stands facing +z (toward the camera), x is the figure's LEFT, y is up, units are "
    "metres. Joints and where they sit at rest, as a share of the height: hips 0.53 (the pelvis), spine 0.59, "
    "chest 0.71, neck 0.85, head 0.90 (the base of the skull; the face is about 0.06 x height above it), arms hang "
    "down from the shoulders (at 0.82; left_arm at x +0.12 x height), forearms start at the elbows 0.18 x height below the "
    "shoulders, hands at the wrists 0.16 below the elbows, legs from the hip joints, shins from the knees 0.24 "
    "below, feet at the ankles 0.25 below the knees. A part's offset is from its joint, in the joint's frame (at "
    "rest, the same axes as the figure); an upper arm part therefore hangs at negative y, e.g. offset [0, -0.09 x "
    "height, 0]."
)
MODEL_SYSTEM = (
    "You are a 3D character modeller for a stylised game. You build each character from simple shapes attached "
    "to the joints of a humanoid skeleton. " + RIG_NOTES + " Rig: height in metres, and build factors (1 = average) "
    "for shoulders, hips, arms and legs. Make each character instantly recognisable from the design: body shape, "
    "skin, hair (and its style), face (eyes, nose, mouth, beard, glasses), clothes with their colours and layers "
    "(a robe is a cone or cylinder on the chest and hips, sleeves on the arms), hats, and what they always carry. "
    "Cover every limb segment. 15 to 45 parts. Colours are #rrggbb. Sizes are full widths/heights/depths in metres."
)
PROP_SYSTEM = (
    "You are a 3D prop modeller for a stylised game. Build each object from simple shapes, at its real size in "
    "metres, standing on the floor at the origin (y = 0 is the bottom) and facing +z. Make it recognisable: "
    "proportions, colours (#rrggbb), materials (roughness 0 to 1, metal 0 to 1, glow for lights and magic). "
    "2 to 25 parts. A part's offset is the centre of the shape."
)
ANIMATOR_SYSTEM = (
    "You are an animator for a stylised 3D game. You write clips as keyframes of joint controls, in degrees. "
    "The figure faces +z. Controls: arms: raise (0 hanging down, 90 pointing forward, 180 straight up), spread (0 "
    "at the side, 90 out to the side, 180 up), twist; forearms: bend (0 straight, 140 fully bent, hand toward the "
    "shoulder); hands: bend, twist; legs: lift (0 down, 90 thigh forward), spread; shins: bend (knee, 0 straight); "
    "feet: bend; spine, chest and hips: bend (forward), turn (to the figure's left), lean (to its right); neck and "
    "head: nod (down), turn (to its left), tilt (to its right). `drop` lowers the hips in metres (crouch, kneel). "
    "A joint missing from a key keeps its rest pose (0) at that key, so key every joint a clip moves at t = 0 and at "
    "the end. Make motions readable from a distance, with anticipation and follow-through; one action, 0.6 to 4 "
    "seconds. Base clips loop: idle (breathing, a small weight shift), walk (one full stride cycle: legs and "
    "opposite arms swing), talk (small gestures, head moves). An action clip shows exactly what its text says, "
    "for example handing something over: the right arm raises forward to about 70 with the forearm bend easing "
    "from 60 to 10, held a moment, then back."
)


def part_schema() -> dict:
    v3 = {"type": "array", "items": N}
    return obj({"joint": S, "shape": S, "size": v3, "offset": v3, "rotation": v3, "color": S, "roughness": N, "metal": N, "glow": B})


def clip_schema() -> dict:
    pose = obj({k: N for k in ("raise", "spread", "twist", "bend", "lift", "nod", "turn", "tilt", "lean")})
    key = obj({"t": N, "joints": arr(obj({"joint": S, "pose": pose})), "drop": N})
    return obj({"name": S, "duration": N, "loop": B, "keys": arr(key)})


class Modeler:
    def __init__(self, model: Model):
        self.model = model

    def characters(self, designs) -> dict[str, dict]:
        """Character id -> {"rig", "parts"}; a few characters per request."""
        out = {}
        for k in range(0, len(designs), 4):
            batch = designs[k : k + 4]
            items = [{"id": d.id, "design": d.prompt, "clothes_and_colours": d.texture, "height_m": d.height_m} for d in batch]
            rig = obj({"height": N, "shoulders": N, "hips": N, "arms": N, "legs": N})
            schema = obj({"characters": arr(obj({"id": S, "rig": rig, "parts": arr(part_schema())}))})
            heights = {d.id: d.height_m for d in batch}
            a = self.model.ask(MODEL_SYSTEM, f"Model characters {k + 1}-{k + len(batch)}", items, schema, effort="medium",
                               check=lambda a, h=heights: character_errors(a, h), repairs=3)  # fmt: skip
            out.update({c["id"]: {"rig": c["rig"], "parts": [clean_part(p) for p in c["parts"]]} for c in a["characters"] if c["id"] in heights})
        return out

    def props(self, things: list[dict], task: str) -> dict[str, dict]:
        """Prop id -> {"parts", "size"}. `things`: {"id", "prompt", "size_m"}."""
        schema = obj({"props": arr(obj({"id": S, "parts": arr(part_schema())}))})
        sizes = {t["id"]: t["size_m"] for t in things}
        a = self.model.ask(PROP_SYSTEM, task, things, schema, effort="low", check=lambda a: prop_errors(a, sizes), repairs=2)
        return {p["id"]: {"parts": [clean_part(x) for x in p["parts"]], "size": sizes[p["id"]]} for p in a["props"] if p["id"] in sizes}

    def base_clips(self) -> dict[str, dict]:
        """idle, walk and talk, written once and shared by every character."""
        schema = obj({"clips": arr(clip_schema())})
        a = self.model.ask(ANIMATOR_SYSTEM, "Write the base clips: idle, walk, talk", [{"name": n} for n in ("idle", "walk", "talk")],
                           schema, effort="medium", check=lambda a: clip_errors(a["clips"], {"idle", "walk", "talk"}), repairs=3)  # fmt: skip
        return {c["name"]: to_clip(c) for c in a["clips"]}

    def action_clips(self, actions: dict[str, list[str]]) -> dict[str, dict[str, dict]]:
        """Character id -> action text -> clip, one request for the chapter."""
        wanted = [{"character": who, "action": a, "name": clip_name(a)} for who, acts in actions.items() for a in acts]
        if not wanted:
            return {}
        schema = obj({"clips": arr(clip_schema())})
        names = {w["name"] for w in wanted}
        a = self.model.ask(ANIMATOR_SYSTEM, "Write a clip for each action (use the given name)", wanted, schema, effort="medium",
                           check=lambda a: clip_errors(a["clips"], names), repairs=3)  # fmt: skip
        by_name = {c["name"]: to_clip(c) for c in a["clips"]}
        return {who: {act: by_name[clip_name(act)] for act in acts if clip_name(act) in by_name} for who, acts in actions.items()}


def built_model(rig_parts: dict, base: dict, actions: dict[str, dict]) -> dict:
    """The engine's `built` spec: rig, parts, clips, and the clip for each use."""
    clips = {**base, **{clip_name(a): c for a, c in actions.items()}}
    uses = {u: u for u in base} | {a: clip_name(a) for a in actions}
    return {"rig": rig_parts["rig"], "parts": rig_parts["parts"], "clips": clips, "uses": uses}


def clip_name(action: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", action.lower()).strip("_")[:48] or "action"


def to_clip(c: dict) -> dict:
    """The model's clip -> the engine's clip (joints as a mapping, zeros dropped)."""
    keys = []
    for k in sorted(c["keys"], key=lambda k: k["t"]):
        joints = {j["joint"]: {n: v for n, v in j["pose"].items() if v} for j in k["joints"]}
        key = {"t": round(k["t"], 3), "joints": joints}
        if k["drop"]:
            key["drop"] = k["drop"]
        keys.append(key)
    return {"duration": c["duration"], "loop": c["loop"], "keys": keys}


def clean_part(p: dict) -> dict:
    out = {k: p[k] for k in ("joint", "shape", "size", "offset", "rotation", "color")}
    if p["roughness"] not in (None, 0.8):
        out["roughness"] = max(0, min(1, p["roughness"]))
    if p["metal"]:
        out["metal"] = max(0, min(1, p["metal"]))
    if p["glow"]:
        out["glow"] = True
    return out


# ---- checks --------------------------------------------------------------------


def part_errors(p: dict, where: str, limit: float, joints: set[str]) -> list[str]:
    out = []
    if p["joint"] not in joints:
        out.append(f"{where}: joint {p['joint']!r} must be one of {sorted(joints)}")
    if p["shape"] not in SHAPES:
        out.append(f"{where}: shape must be one of {SHAPES}")
    for k in ("size", "offset", "rotation"):
        if len(p[k]) != 3:
            out.append(f"{where}: {k} needs 3 numbers")
    if len(p["size"]) == 3 and not all(0.003 <= s <= limit for s in p["size"]):
        out.append(f"{where}: size {p['size']} must be between 0.003 and {limit:.2f} m")
    if len(p["offset"]) == 3 and any(abs(o) > limit for o in p["offset"]):
        out.append(f"{where}: offset {p['offset']} is too far from its joint")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", p["color"]):
        out.append(f"{where}: color must be #rrggbb")
    return out


def character_errors(a: dict, heights: dict[str, float]) -> list[str]:
    out = [f"missing character {i}" for i in heights if i not in {c["id"] for c in a["characters"]}]
    for c in a["characters"]:
        if c["id"] not in heights:
            continue
        h = heights[c["id"]]
        if abs(c["rig"]["height"] - h) > 0.15 * h:
            out.append(f"{c['id']}: rig height should be about {h} m")
        out += [f"{c['id']}: build factor {k}={c['rig'][k]} must be between 0.6 and 1.8" for k in ("shoulders", "hips", "arms", "legs") if not 0.6 <= c["rig"][k] <= 1.8]
        if not 12 <= len(c["parts"]) <= 60:
            out.append(f"{c['id']}: use 12 to 60 parts (has {len(c['parts'])})")
        covered = {p["joint"] for p in c["parts"]}
        out += [f"{c['id']}: no part on {j}, so it would be invisible" for j in MUST_COVER if j not in covered]
        for i, p in enumerate(c["parts"]):
            out += part_errors(p, f"{c['id']} part {i}", h * 0.8, set(JOINTS) | {"root"})
    return out


def prop_errors(a: dict, sizes: dict[str, float]) -> list[str]:
    out = [f"missing prop {i}" for i in sizes if i not in {p["id"] for p in a["props"]}]
    for p in a["props"]:
        if p["id"] not in sizes:
            continue
        if not 1 <= len(p["parts"]) <= 30:
            out.append(f"{p['id']}: use 1 to 30 parts")
        for i, x in enumerate(p["parts"]):
            out += part_errors(x, f"{p['id']} part {i}", sizes[p["id"]] * 1.2 + 0.05, {"root"})
    return out


def clip_errors(clips: list[dict], names: set[str]) -> list[str]:
    out = [f"missing clip {n}" for n in names if n not in {c["name"] for c in clips}]
    for c in clips:
        w = f"clip {c['name']}"
        if not 0.4 <= c["duration"] <= 6:
            out.append(f"{w}: duration must be 0.4 to 6 s")
        if len(c["keys"]) < 2:
            out.append(f"{w}: needs at least two keys")
        times = [k["t"] for k in c["keys"]]
        if times != sorted(times) or any(not 0 <= t <= c["duration"] + 1e-6 for t in times):
            out.append(f"{w}: key times must rise from 0 to the duration")
        for k in c["keys"]:
            if not -0.05 <= k["drop"] <= 1.2:
                out.append(f"{w} t={k['t']}: drop must be 0 to 1.2 m")
            for j in k["joints"]:
                if j["joint"] not in JOINTS:
                    out.append(f"{w} t={k['t']}: unknown joint {j['joint']!r}")
                    continue
                allowed = CONTROLS[joint_kind(j["joint"])]
                for ctl, v in j["pose"].items():
                    if not v:
                        continue
                    if ctl not in allowed:
                        out.append(f"{w} t={k['t']}: {j['joint']} has no {ctl!r} (it takes {sorted(allowed)})")
                    elif not allowed[ctl][0] <= v <= allowed[ctl][1]:
                        out.append(f"{w} t={k['t']}: {j['joint']} {ctl} {v} is outside {allowed[ctl]}")
    return out
