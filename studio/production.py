"""Production: from screenplays to generated 3D assets.

1. Gather who, where and what the screenplays use.
2. The designers write grounded descriptions (bible.py).
3. A casting agent picks each character's clips from Meshy's animation
   library: idle, walking, talking, and one for each kind of action the
   script gives them ("hands over a bag" -> a giving clip).
4. Estimate the credits; only with `generate=True` call Meshy.

The result is production.json: every asset's files, the clip chosen for each
use, and the designs with their citations.
"""

import json
from dataclasses import asdict
from pathlib import Path

from .bible import Designer
from .llm import I, S, Model, arr, obj

CREDITS = {"model": 15, "rig": 5, "clip": 3, "prop": 15}  # docs.meshy.ai pricing, 2026-11-26
BASE_USES = ["idle", "walk", "talk"]
CASTING_SYSTEM = (
    "You are the animation director of a 3D game made from a novel. For each character you get the actions "
    "their script gives them. From the animation library (id, name, category) pick clips: one for idle, one for "
    "walk, one for talk, and one for each action that needs its own motion (hands something over, falls, hugs, "
    "points, runs, casts a spell). Several actions may share a clip. At most ten clips per character. Use only "
    "library ids whose rig type matches the character (biped or quadruped)."
)


def needs(screenplays) -> dict:
    """Who, where and what the screenplays use, with each person's actions."""
    people, places, objects = {}, {}, {}
    for sp in screenplays:
        for o in sp.objects:
            objects.setdefault(o["id"], o)
        for s in sp.scenes:
            places.setdefault(s["place"], {"id": s["place"], "description": s["place_description"]})
            beats = s["beats"] + [b for c in s["choices"] for o in c["options"] for b in o["consequence"]]
            for who in s["cast"]:
                people.setdefault(who, [])
            for b in beats:
                if b["who"]:
                    people.setdefault(b["who"], [])
                if b["kind"] == "do" and b["text"] not in people[b["who"]]:
                    people[b["who"]].append(b["text"])
    return {"people": people, "places": list(places.values()), "objects": list(objects.values())}


class Production:
    def __init__(self, model: Model, designer: Designer, index, meshy=None):
        self.model, self.designer, self.index, self.meshy = model, designer, index, meshy

    def plan(self, screenplays, library: list[dict]) -> dict:
        need = needs(screenplays)
        people = [p for p in self.index.cast if p.id in need["people"]]
        characters = self.designer.characters(people)
        places = self.designer.places(need["places"])
        objects = self.designer.objects(need["objects"])
        clips = self.cast_clips(characters, need["people"], library)
        pieces = sum(p["count"] > 0 for d in places for p in d.pieces)
        estimate = len(characters) * (CREDITS["model"] + CREDITS["rig"]) + sum(len(v) for v in clips.values()) * CREDITS["clip"] + (pieces + len(objects)) * CREDITS["prop"]
        return {"characters": [asdict(c) for c in characters], "places": [asdict(p) for p in places], "objects": [asdict(o) for o in objects],
                "clips": clips, "estimate_credits": estimate}  # fmt: skip

    def cast_clips(self, characters, actions: dict, library: list[dict]) -> dict[str, dict[str, int]]:
        """Character id -> use ("idle", "walk", "talk" or an action's text) -> library action id."""
        lib = {a["action_id"]: a for a in library}
        menu = [f"{a['action_id']}: {a['name']} ({a.get('category', '')}, {a.get('rig_type', 'biped')})" for a in library]
        items = {"library": menu, "characters": [{"id": c.id, "rig": "quadruped" if c.quadruped else "biped", "uses": BASE_USES + actions.get(c.id, [])} for c in characters]}
        schema = obj({"characters": arr(obj({"id": S, "clips": arr(obj({"use": S, "action_id": I}))}))})
        rig = {c.id: "quadruped" if c.quadruped else "biped" for c in characters}

        def errors(a):
            out = []
            for ch in a["characters"]:
                for c in ch["clips"]:
                    if c["action_id"] not in lib:
                        out.append(f"{ch['id']}: action_id {c['action_id']} is not in the library")
                    elif lib[c["action_id"]].get("rig_type", "biped") != rig.get(ch["id"], "biped"):
                        out.append(f"{ch['id']}: action {c['action_id']} is for a {lib[c['action_id']].get('rig_type')} rig")
                if len({c["action_id"] for c in ch["clips"]}) > 10:
                    out.append(f"{ch['id']}: more than ten different clips")
                missing = [u for u in BASE_USES if u not in {c["use"] for c in ch["clips"]}]
                out += [f"{ch['id']}: no clip for {u}" for u in missing]
            return out

        a = self.model.ask(CASTING_SYSTEM, "Cast the clips", items, schema, effort="low", check=errors)
        return {ch["id"]: {c["use"]: c["action_id"] for c in ch["clips"]} for ch in a["characters"] if ch["id"] in rig}

    def generate(self, plan: dict) -> dict:
        """Call Meshy for everything in the plan. Returns production.json's assets."""
        assets = {"characters": {}, "props": {}}
        for c in plan["characters"]:
            model = self.meshy.model(c["prompt"], c["texture"], character=True)
            rig = self.meshy.rig(model, c["height_m"], c["quadruped"])
            clips = self.meshy.clips(rig, list(plan["clips"].get(c["id"], {}).values()))
            assets["characters"][c["id"]] = {"model": model.files, "rig": rig.files, "clips": clips.files, "height_m": c["height_m"]}
        for o in plan["objects"]:
            a = self.meshy.model(o["prompt"], o["prompt"], character=False)
            assets["props"][o["id"]] = {"model": a.files, "size_m": o["size_m"], "held": o["held"]}
        for p in plan["places"]:
            for piece in p["pieces"]:
                a = self.meshy.model(piece["prompt"], piece["prompt"], character=False)
                assets["props"][f"{p['id']}.{piece['id']}"] = {"model": a.files, "size_m": piece["size_m"], "held": False}
        return assets


def save(path: Path, plan: dict, assets: dict | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**plan, "assets": assets or {}}, indent=1, ensure_ascii=False))
