"""Production: from screenplays to 3D assets, made by the model itself.

1. Gather who, where and what the screenplays use, and each person's actions.
2. The designers write grounded descriptions (bible.py).
3. The modeller builds every character, object and set piece from shapes;
   the animator writes the shared base clips (idle, walk, talk) and a clip for
   each action in the script (modeler.py).

The result is production.json: every model, ready for the engine.
"""

import json
from dataclasses import asdict
from pathlib import Path

from .bible import Designer
from .modeler import Modeler, built_model


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
    def __init__(self, designer: Designer, modeler: Modeler, index):
        self.designer, self.modeler, self.index = designer, modeler, index

    def run(self, screenplays) -> dict:
        need = needs(screenplays)
        characters = self.designer.characters([p for p in self.index.cast if p.id in need["people"]])
        places = self.designer.places(need["places"])
        objects = self.designer.objects(need["objects"])
        bodies = self.modeler.characters(characters)
        base = self.modeler.base_clips()
        actions = self.modeler.action_clips({c.id: need["people"].get(c.id, []) for c in characters})
        built = {c.id: built_model(bodies[c.id], base, actions.get(c.id, {})) for c in characters if c.id in bodies}
        props = self.modeler.props([{"id": o.id, "prompt": o.prompt, "size_m": o.size_m} for o in objects], "Model the objects") if objects else {}
        for o in objects:
            if o.id in props:
                props[o.id]["held"] = o.held
        pieces = {}
        for p in places:
            if p.pieces:
                made = self.modeler.props([{"id": x["id"], "prompt": x["prompt"], "size_m": x["size_m"]} for x in p.pieces], f"Model the set pieces of {p.id}")
                pieces.update({f"{p.id}.{k}": v for k, v in made.items()})
        return {"characters": [asdict(c) for c in characters], "places": [asdict(p) for p in places], "objects": [asdict(o) for o in objects],
                "built": built, "props": props, "pieces": pieces}  # fmt: skip


def save(path: Path, production: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(production, ensure_ascii=False))
