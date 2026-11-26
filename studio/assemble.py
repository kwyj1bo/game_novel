"""Assembly: screenplay + staging + generated assets -> a story the engine plays.

No decisions are made here: every position, clip, prop move and shot comes
from the director; every model from production. This only translates them
into engine beats and splits scenes at the player's choices. A character or
object without a generated model yet is drawn as a plain placeholder.
"""

import re

from .preview import _figure, _parts

ASSETS_URL = "/api/studio-assets"


class Assembler:
    def __init__(self, names: dict[str, str], designs: dict, assets: dict, uses: dict[str, dict[str, str]], layout: dict):
        """`designs`: production plan (characters, places, objects); `assets`: production files;
        `uses`: actor -> use -> clip name; `layout`: place -> placed pieces."""
        self.names, self.assets, self.uses, self.layout = names, assets, uses, layout
        self.characters = {c["id"]: c for c in designs.get("characters", [])}
        self.places = {p["id"]: p for p in designs.get("places", [])}
        self.objects = {o["id"]: o for o in designs.get("objects", [])}

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
        props = {o: self.prop(o) for o in self.objects if self.prop(o)}
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
        a, c = self.assets.get("characters", {}).get(who), self.characters.get(who)
        spec = _figure(who, name)
        if c and "female" in c["voice"]:
            spec["gender"] = "f"
        elif c and "male" in c["voice"]:
            spec["gender"] = "m"
        if a:
            spec["model"] = {"url": url(a["rig"]["rigged"]), "clips": [url(p) for p in a["clips"].values()],
                             "uses": self.uses.get(who, {}), "height": a["height_m"]}  # fmt: skip
        return spec

    def prop(self, oid: str) -> dict | None:
        a = self.assets.get("props", {}).get(oid)
        return {"url": url(a["model"]["model"]), "size": a["size_m"], "held": a["held"]} if a else None

    def scenery(self, s: dict) -> dict:
        p = self.places.get(s["place"])
        title = (s["place_description"] or s["place"])[:60]
        if not p:
            return {"title": title, "preset": {"type": "room", "time": "day", "props": []}}
        pieces = []
        for x in self.layout.get(s["place"], []):
            a = self.assets.get("props", {}).get(f"{p['id']}.{x['piece']}")
            if a:
                pieces.append({"url": url(a["model"]["model"]), "at": [x["x"], x["z"]], "yaw": x["yaw"], "size": a["size_m"]})
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


def url(rel: str) -> str:
    return f"{ASSETS_URL}/{rel}"


def clip_names(clips: dict[str, dict[str, int]], library: list[dict]) -> dict[str, dict[str, str]]:
    """Casting (use -> library id) to engine uses (use -> clip name in the GLB)."""
    names = {a["action_id"]: a["name"] for a in library}
    return {who: {use: names[i] for use, i in m.items() if i in names} for who, m in clips.items()}


def story_id(source: str, title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", f"{source}-{title}".lower()).strip("-")
