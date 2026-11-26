"""The director agent: lays out each set and stages every beat.

Floor coordinates are metres: x from left (-width/2) to right (+width/2),
z from the back wall (-depth/2) to the front (+depth/2), where the camera
stands. The model places set pieces, then for each scene says where people
start and, per beat, the camera shot, who walks or runs where, who looks at
whom, which clip each character performs (only uses their rig has), and
which prop is taken, handed over or put down. A checker keeps everything
inside the set and to the people, clips and props that exist.
"""

from .llm import B, I, N, S, Model, arr, obj

LAYOUT_SYSTEM = (
    "You lay out sets for a 3D game. Floor coordinates are metres: x from -width/2 (left) to +width/2 (right), "
    "z from -depth/2 (back wall) to +depth/2 (front, where the camera is). Place every instance of every set "
    "piece where its note says, against walls when it belongs there, apart from each other, and keep a clear "
    "acting area of about 3 metres around the middle. yaw is in radians, 0 facing the camera."
)
STAGING_SYSTEM = (
    "You are the director of a 3D game made from a novel. Stage each scene so a player who only watches still "
    "follows it. Floor coordinates are metres: x from -width/2 (left) to +width/2 (right), z from -depth/2 "
    "(back) to +depth/2 (front, toward the camera). Set pieces are listed with positions.\n"
    "Give everyone present a start position (people who talk stand 1 to 2 metres apart, facing each other; "
    "keep the acting area in front of the set pieces). Then for each beat, in order: a camera shot (wide for "
    "arrivals and the room, two for a conversation, close for a strong line, over a shoulder, low on someone "
    "threatening); moves (walk or run to a point or up to a person) when the text moves people; looks; the clip "
    "each character performs, using only the uses listed for them (their own actions, and talk/idle/walk); "
    "listeners' reactions; and props: take (appears in someone's hand), give (from one hand to another person) "
    "or put (set down at a point), so objects really change hands. One or two clear things per beat; nobody "
    "moves without a reason."
)
SHOTS = ("wide", "close", "medium", "two", "over", "low", "high")


def layout_schema() -> dict:
    return obj({"sets": arr(obj({"place": S, "pieces": arr(obj({"piece": S, "x": N, "z": N, "yaw": N}))}))})


def staging_schema() -> dict:
    move = obj({"who": S, "x": N, "z": N, "to": S, "run": B})
    beat = obj({"beat": I, "shot": S, "on": S, "with": S, "moves": arr(move), "looks": arr(obj({"who": S, "at": S})),
                "perform": arr(obj({"who": S, "use": S})), "props": arr(obj({"op": S, "prop": S, "who": S, "to": S, "x": N, "z": N}))})  # fmt: skip
    return obj({"scenes": arr(obj({"scene": S, "start": arr(obj({"who": S, "x": N, "z": N})), "beats": arr(beat)}))})


class Director:
    def __init__(self, model: Model):
        self.model = model

    def layout(self, places: list[dict]) -> dict[str, list[dict]]:
        """places: {"id", "size_m": [w, d], "pieces": [{"id", "count", "where", "size_m"}]} -> place -> placed pieces."""
        sizes = {p["id"]: p["size_m"] for p in places}
        wanted = {p["id"]: {x["id"]: x["count"] for x in p["pieces"]} for p in places}

        def errors(a):
            out = []
            for s in a["sets"]:
                if s["place"] not in sizes:
                    out.append(f"unknown place {s['place']}")
                    continue
                w, d = sizes[s["place"]]
                for p in s["pieces"]:
                    if p["piece"] not in wanted[s["place"]]:
                        out.append(f"{s['place']}: unknown piece {p['piece']}")
                    if not (-w / 2 <= p["x"] <= w / 2 and -d / 2 <= p["z"] <= d / 2):
                        out.append(f"{s['place']}: {p['piece']} at ({p['x']}, {p['z']}) is outside the {w} x {d} set")
                counts = {k: sum(p["piece"] == k for p in s["pieces"]) for k in wanted[s["place"]]}
                out += [f"{s['place']}: {k} needs {n} instances, has {counts[k]}" for k, n in wanted[s["place"]].items() if counts[k] != n]
            return out + [f"no layout for {p}" for p in sizes if p not in {s["place"] for s in a["sets"]}]

        a = self.model.ask(LAYOUT_SYSTEM, "Lay out the sets", places, layout_schema(), effort="low", check=errors)
        return {s["place"]: s["pieces"] for s in a["sets"]}

    def stage(self, screenplay, sets: dict, uses: dict[str, list[str]], props: set[str]) -> dict[str, dict]:
        """Scene id -> {"start": {who: [x, z]}, "beats": {index: staging}}.
        `sets`: place -> {"size_m", "pieces" (placed)}; `uses`: actor -> clip uses."""
        scenes = [{"scene": s["id"], "place": s["place"], "set": sets.get(s["place"], {}), "present_at_start": s["cast"],
                   "beats": [{"beat": i, **b} for i, b in enumerate(s["beats"])]} for s in screenplay.scenes]  # fmt: skip
        items = {"uses": uses, "props": sorted(props), "scenes": scenes}
        a = self.model.ask(STAGING_SYSTEM, "Stage the scenes", items, staging_schema(), effort="high",
                           check=lambda a: staging_errors(a, screenplay, sets, uses, props), repairs=3)  # fmt: skip
        return {s["scene"]: {"start": {x["who"]: [x["x"], x["z"]] for x in s["start"]}, "beats": {b["beat"]: b for b in s["beats"]}} for s in a["scenes"]}


def staging_errors(a: dict, screenplay, sets: dict, uses: dict[str, list[str]], props: set[str]) -> list[str]:
    out = []
    scenes = {s["id"]: s for s in screenplay.scenes}
    for st in a["scenes"]:
        s = scenes.get(st["scene"])
        if not s:
            out.append(f"unknown scene {st['scene']}")
            continue
        w, d = sets.get(s["place"], {}).get("size_m", [12, 12])
        inside = lambda x, z: -w / 2 <= x <= w / 2 and -d / 2 <= z <= d / 2  # noqa: E731
        here = set(s["cast"])
        out += [f"{s['id']}: {x['who']} starts outside the set" for x in st["start"] if not inside(x["x"], x["z"])]
        out += [f"{s['id']}: no start position for {who}" for who in s["cast"] if who not in {x["who"] for x in st["start"]}]
        holders: dict[str, str] = {}
        for b in sorted(st["beats"], key=lambda b: b["beat"]):
            w_ = f"{s['id']} beat {b['beat']}"
            if not 0 <= b["beat"] < len(s["beats"]):
                out.append(f"{w_}: the scene has no such beat")
                continue
            src = s["beats"][b["beat"]]
            if src["kind"] == "enter":
                here.add(src["who"])
            if b["shot"] and b["shot"] not in SHOTS:
                out.append(f"{w_}: shot must be one of {', '.join(SHOTS)}")
            out += [f"{w_}: camera on {t!r}, who is not here" for t in (b["on"], b["with"]) if t and t not in here]
            for m in b["moves"]:
                if m["who"] not in here:
                    out.append(f"{w_}: {m['who']} moves but is not here")
                elif m["to"] and m["to"] not in here:
                    out.append(f"{w_}: {m['who']} walks to {m['to']}, who is not here")
                elif not m["to"] and not inside(m["x"], m["z"]):
                    out.append(f"{w_}: {m['who']} walks outside the set")
            out += [f"{w_}: {x['who']} or {x['at']} is not here" for x in b["looks"] if x["who"] not in here or x["at"] not in here]
            for p in b["perform"]:
                if p["who"] not in here:
                    out.append(f"{w_}: {p['who']} performs but is not here")
                elif p["use"] not in uses.get(p["who"], []):
                    out.append(f"{w_}: {p['who']} has no clip for {p['use']!r}; use one of {uses.get(p['who'], [])}")
            for p in b["props"]:
                out += _prop_errors(p, w_, here, props, holders, inside)
            if src["kind"] == "exit":
                here.discard(src["who"])
    return out + [f"scene {i} is not staged" for i in scenes if i not in {st["scene"] for st in a["scenes"]}]


def _prop_errors(p: dict, where: str, here: set, props: set, holders: dict, inside) -> list[str]:
    if p["prop"] not in props:
        return [f"{where}: unknown prop {p['prop']!r}"]
    if p["op"] == "take":
        if p["who"] not in here:
            return [f"{where}: {p['who']} takes {p['prop']} but is not here"]
        holders[p["prop"]] = p["who"]
    elif p["op"] == "give":
        if holders.get(p["prop"]) != p["who"]:
            return [f"{where}: {p['who']} gives {p['prop']} without holding it (take it first)"]
        if p["to"] not in here:
            return [f"{where}: {p['prop']} is given to {p['to']}, who is not here"]
        holders[p["prop"]] = p["to"]
    elif p["op"] == "put":
        if not inside(p["x"], p["z"]):
            return [f"{where}: {p['prop']} is put outside the set"]
        holders.pop(p["prop"], None)
    else:
        return [f"{where}: prop op must be take, give or put"]
    return []
