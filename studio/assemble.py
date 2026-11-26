"""Assembly: screenplay + staging + built models -> a story the engine plays.

No decisions are made here: every position, clip, prop move and shot comes
from the director; every model and clip from production. This only translates
them into engine beats and splits scenes at the player's choices.
"""

import re

from .preview import _figure, _parts

class Assembler:
    def __init__(self, names: dict[str, str], production: dict, layout: dict):
        """`production`: designs and built models (production.py); `layout`: place -> placed pieces."""
        self.names, self.layout = names, layout
        self.built: dict = production.get("built", {})
        self.props: dict = production.get("props", {})
        self.pieces: dict = production.get("pieces", {})
        self.uses = {who: b["uses"] for who, b in self.built.items()}
        self.characters = {c["id"]: c for c in production.get("characters", [])}
        self.places = {p["id"]: p for p in production.get("places", [])}

    def story(self, sp, staging: dict, story_id: str, source: str) -> dict:
        scenes, actors, places = {}, {}, {}
        parts = _parts(sp)
        for n, (s, beats, choice) in enumerate(parts):
            sid = f"scene_{n + 1}"
            st = staging.get(s["id"], {"start": {}, "beats": {}})
            places.setdefault(f"set_{s['place']}", self.scenery(s))
            offset = s["beats"].index(beats[0]) if beats else 0
            on = set(s["cast"]) if n == 0 or parts[n - 1][0] is not s else set(self._present(s, offset))
            cast = {w: st["start"].get(w, [0.0, 0.0]) for w in on}
            out = [{"camera": "wide", "ms": 0}]
            for k, b in enumerate(beats):
                out += self.beats(b, st["beats"].get(offset + k), on)
            for who in set(cast) | {b["who"] for b in s["beats"] if b["who"]}:
                actors.setdefault(who, self.actor(who))
            scene = {"title": places[f"set_{s['place']}"]["title"], "location": f"set_{s['place']}", "cast": cast, "beats": out}
            if choice:
                wrong = f"{sid}_wrong"
                scene["choice"] = {"prompt": choice["prompt"], "seconds": 15, "options": [
                    {"label": o["label"], "correct": o["correct"], "goto": f"scene_{n + 2}" if o["correct"] else wrong} for o in choice["options"]]}  # fmt: skip
                bad = next(o for o in choice["options"] if not o["correct"])
                left = set(on)
                scenes[wrong] = {"location": f"set_{s['place']}", "cast": {w: cast.get(w, [0.0, 0.0]) for w in on},
                                 "beats": [x for b in bad["consequence"] for x in self.beats(b, None, left)] or [{"narrate": "It goes wrong."}],
                                 "ending": {"kind": "failure", "title": "Not How It Happened", "text": "In the book, it went differently."}}  # fmt: skip
            elif n + 1 < len(parts):
                scene["goto"] = f"scene_{n + 2}"
            else:
                scene["ending"] = {"kind": "victory", "title": sp.title, "text": f"You played “{sp.title}” the way the book tells it."}
            scenes[sid] = scene
        props = {o: {"parts": p["parts"], "size": p["size"], "held": p.get("held", False)} for o, p in self.props.items()}
        return {"id": story_id, "title": sp.title, "subtitle": source, "start": "scene_1", "actors": actors, "scenes": scenes,
                "sceneries": places, **({"props": props} if props else {})}  # fmt: skip

    def beats(self, b: dict, st: dict | None, on: set) -> list[dict]:
        """One screenplay beat, staged: shot, moves, looks, props, clips, then its line."""
        out: list[dict] = []
        who = b["who"]
        if b["kind"] == "enter" and who not in on:
            on.add(who)
            out.append({"spawn": who, "at": "auto_entry"})
        st = st or {}
        if st.get("shot"):
            cam = {"camera": st["shot"], "ms": 600}
            cam.update({k: st[k] for k in ("on", "with") if st.get(k) in on})
            out.append(cam)
        for m in st.get("moves", []):
            if m["who"] in on:
                to = m["to"] if m["to"] in on else [m["x"], m["z"]]
                out.append({"move": m["who"], "to": to, **({"run": True} if m["run"] else {})})
        out += [{"look": x["who"], "at": x["at"]} for x in st.get("looks", []) if x["who"] in on and x["at"] in on]
        puts = []
        for p in st.get("props", []):
            if p["op"] == "take":
                out.append({"take": p["prop"], "actor": p["who"]})
            elif p["op"] == "give":
                puts.append({"give": p["prop"], "from": p["who"], "to": p["to"]})
            elif p["op"] == "put":
                puts.append({"put": p["prop"], "at": [p["x"], p["z"]]})
        for p in st.get("perform", []):
            if p["who"] in on and p["use"] in self.uses.get(p["who"], {}):
                # The doer's action is waited for; everyone else reacts at the same time.
                out.append({"perform": p["who"], "use": p["use"], **({} if p["who"] == who and b["kind"] == "do" else {"async": True})})
        out += puts
        name = self.names.get(who, who)
        if b["kind"] == "narrate":
            out.append({"narrate": b["text"]})
        elif b["kind"] == "say" and who in on:
            line = {"say": who, "text": b["text"]}
            if b["mood"] in ("calm", "urgent", "scared", "angry", "whisper"):
                line["mood"] = b["mood"]
            out.append(line)
        elif b["kind"] == "do" and who in on:
            out.append({"narrate": f"{name} {b['text']}"})
        elif b["kind"] == "exit" and who in on:
            on.discard(who)
            out += [{"move": who, "to": "auto_entry"}, {"despawn": who}]
        return out

    def actor(self, who: str) -> dict:
        name = self.names.get(who, who)
        c = self.characters.get(who)
        spec = _figure(who, name)
        if c and "female" in c["voice"]:
            spec["gender"] = "f"
        elif c and "male" in c["voice"]:
            spec["gender"] = "m"
        if who in self.built:
            spec["built"] = self.built[who]
            spec["height"] = self.built[who]["rig"]["height"]
        return spec

    def scenery(self, s: dict) -> dict:
        p = self.places.get(s["place"])
        title = (s["place_description"] or s["place"])[:60]
        if not p:
            return {"title": title, "preset": {"type": "room", "time": "day", "props": []}}
        pieces = []
        for x in self.layout.get(s["place"], []):
            made = self.pieces.get(f"{p['id']}.{x['piece']}")
            if made:
                pieces.append({"parts": made["parts"], "at": [x["x"], x["z"]], "yaw": x["yaw"], "size": made["size"]})
        return {"title": title, "set": {"indoor": p["indoor"], "size": p["size_m"], "floor": p["floor_color"], "wall": p["wall_color"], "light": p["light"], "pieces": pieces}}

    @staticmethod
    def _present(s: dict, upto: int) -> list[str]:
        here = list(s["cast"])
        for b in s["beats"][:upto]:
            if b["kind"] == "enter" and b["who"] not in here:
                here.append(b["who"])
            if b["kind"] == "exit" and b["who"] in here:
                here.remove(b["who"])
        return here


def story_id(source: str, title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", f"{source}-{title}".lower()).strip("-")
