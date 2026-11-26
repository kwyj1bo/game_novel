"""A temporary preview: plays a screenplay on the current engine with plain
placeholder figures and rooms, so the script can be watched before the 3D
assets exist. The generated-asset engine replaces this.
"""

import hashlib
import re

from .screenplay import Screenplay

ROBES = ["#2a2238", "#1f3a4a", "#3a2a1a", "#2e3a24", "#4a1f24", "#22262e", "#3a3044"]
HAIRS = ["#120d08", "#3a2414", "#5a3418", "#8a5a2a", "#c2501e", "#d8c080", "#6a6a6a"]
SPOTS = ["auto_1", "auto_2", "auto_3", "auto_4", "auto_5"]
OUTDOOR = re.compile(r"\b(street|road|forest|wood|field|garden|lake|sea|shore|beach|village|mountain|pitch|outside|yard|deck|platform)\b", re.I)


def to_story(sp: Screenplay, names: dict[str, str], source: str) -> dict:
    """The engine's story format: scenes split at choices, wrong options as
    endings, everyone on numbered spots."""
    scenes, places, actors = {}, {}, {}
    parts = _parts(sp)
    for n, (s, beats, choice) in enumerate(parts):
        sid = f"scene_{n + 1}"
        places.setdefault(s["place"], {"title": s["place_description"][:60] or s["place"], "preset": _room(s)})
        cast = {who: SPOTS[i] for i, who in enumerate(s["cast"][:5])}
        for who in s["cast"]:
            actors.setdefault(who, _figure(who, names.get(who, who)))
        out = [{"camera": "wide", "ms": 0}]
        on = set(cast)
        for b in beats:
            out += _beat(b, names, on, cast, actors)
        scene = {"title": places[s["place"]]["title"], "location": f"gen_{s['place']}", "cast": cast, "beats": out}
        if choice:
            wrong = f"{sid}_wrong"
            scene["choice"] = {"prompt": choice["prompt"], "seconds": 15, "options": [
                {"label": o["label"], "correct": o["correct"], "goto": f"scene_{n + 2}" if o["correct"] else wrong} for o in choice["options"]]}  # fmt: skip
            bad = next(o for o in choice["options"] if not o["correct"])
            wb = [x for b in bad["consequence"] for x in _beat(b, names, set(on), dict(cast), actors)]
            scenes[wrong] = {"location": f"gen_{s['place']}", "cast": {w: m for w, m in cast.items() if w in on},
                             "beats": wb or [{"narrate": "It goes wrong."}],
                             "ending": {"kind": "failure", "title": "Not How It Happened", "text": "In the book, it went differently."}}  # fmt: skip
        elif n + 1 < len(parts):
            scene["goto"] = f"scene_{n + 2}"
        else:
            scene["ending"] = {"kind": "victory", "title": sp.title, "text": f"You played “{sp.title}” the way the book tells it."}
        scenes[sid] = scene
    return {"id": _slug(f"{source}-{sp.title}"), "title": sp.title, "subtitle": source, "start": "scene_1", "actors": actors,
            "scenes": scenes, "sceneries": {f"gen_{k}": v for k, v in places.items()}}  # fmt: skip


def _parts(sp: Screenplay) -> list[tuple[dict, list[dict], dict | None]]:
    out = []
    for s in sp.scenes:
        start = 0
        for ch in sorted(s["choices"], key=lambda c: c["after_beat"]):
            out.append((s, s["beats"][start : ch["after_beat"] + 1], ch))
            start = ch["after_beat"] + 1
        if start < len(s["beats"]) or not s["choices"]:
            out.append((s, s["beats"][start:], None))
    return out


def _beat(b: dict, names: dict, on: set, cast: dict, actors: dict) -> list[dict]:
    who, name = b["who"], names.get(b["who"], b["who"])
    if b["kind"] == "narrate":
        return [{"narrate": b["text"]}]
    if b["kind"] == "enter" and who not in on:
        actors.setdefault(who, _figure(who, name))
        spot = next((s for s in SPOTS if s not in cast.values()), "auto_5")
        cast[who] = spot
        on.add(who)
        return [{"spawn": who, "at": "auto_entry"}, {"move": who, "to": spot}]
    if b["kind"] == "exit" and who in on:
        on.discard(who)
        return [{"move": who, "to": "auto_entry"}, {"despawn": who}]
    if who not in on:
        return []
    if b["kind"] == "say":
        beat = {"say": who, "text": b["text"]}
        if b["mood"] in ("calm", "urgent", "scared", "angry", "whisper"):
            beat["mood"] = b["mood"]
        look = [{"look": who, "at": b["to"]}] if b["to"] in on and b["to"] != who else []
        return [*look, {"camera": "close", "on": who, "ms": 400}, beat]
    if b["kind"] == "do":
        move = [{"move": who, "to": b["to"]}] if b["to"] in on and b["to"] != who else []
        return [*move, {"narrate": f"{name} {b['text']}"}]
    return []


def _figure(who: str, name: str) -> dict:
    h = int(hashlib.sha1(who.encode()).hexdigest()[:8], 16)
    return {"name": name, "height": round(1.5 + (h % 30) / 100, 2), "robe": ROBES[h % 7], "hair": HAIRS[(h >> 4) % 7],
            "hairStyle": ["short", "messy", "long", "bushy"][(h >> 8) % 4], "outfit": "adult", "voice": 1.0}  # fmt: skip


def _room(s: dict) -> dict:
    text = f"{s['place']} {s['place_description']}"
    return {"type": "street" if OUTDOOR.search(text) else "room", "time": "night" if re.search(r"night|dark|midnight", s["time"], re.I) else "day", "props": []}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "story"
