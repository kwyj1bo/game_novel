"""Blocking: where each character stands, who walks in when, and what they do.

The rules put everyone on numbered spots in order of appearance and turn
verbs into actions ("go", "move", "come" all become `approach`). Here the
model reads the shown lines of each scene with the place's named spots, the
people who could be there and the engine's action list, and answers with a
staging plan. Every part of the plan is checked against what the engine has:
a spot that does not exist, a person who is not in the scene or an action a
creature cannot do is dropped, and the rules fill the gap.
"""

from dataclasses import dataclass, field

from ..analyze import CREATURE_ACTIONS, HANDED_KINDS

SYSTEM = (
    "You stage scenes of a novel for a 3D game, like a theatre director. For each scene part you get the place, "
    "its spots, the people who may be there and the lines the player will see, numbered. Decide: who is "
    "physically present when the part starts and on which spot; who walks in later, at which line, and to "
    "which spot; and, per line, the actions that show what the text describes, using only the listed actions. "
    "Leave out people who are only mentioned or remembered. Put people who talk to each other on nearby spots, "
    "people at a fire, table or bed by that prop, and monsters on the threat spot. Prefer one clear action per "
    "line over many; most dialogue lines need no action. Keep a person on one spot unless the text moves them."
)
AUTO_SPOTS = {
    "auto_1": "front centre", "auto_2": "left of centre", "auto_3": "right of centre",
    "auto_4": "far left", "auto_5": "far right", "auto_threat": "back of the room, facing everyone (for monsters)",
    "auto_entry": "the way in (people who arrive come from here)",
}  # fmt: skip
GROUP_SPOTS = ["auto_1", "auto_2", "auto_3", "auto_4", "auto_5"]


@dataclass
class Plan:
    start: dict[str, str] = field(default_factory=dict)  # actor -> spot
    enter: dict[str, tuple[int, str]] = field(default_factory=dict)  # actor -> (line, spot)
    lines: dict[int, list[dict]] = field(default_factory=dict)  # line -> beats
    dropped: int = 0  # suggestions that failed the checks

    @property
    def cast(self) -> list[str]:
        return [*self.start, *self.enter]

    @property
    def kept(self) -> int:
        return len(self.start) + len(self.enter) + sum(len(b) for b in self.lines.values())


def spots_of(location: str, catalog, places: dict) -> list[str]:
    if location in catalog["locations"]:
        return list(catalog["locations"][location]["marks"])
    preset = (places.get(location) or {}).get("preset", {})
    return [*AUTO_SPOTS, *dict.fromkeys(f"at_{p['kind']}" for p in preset.get("props", []))]


def describe(spot: str) -> str:
    if spot in AUTO_SPOTS:
        return f"{spot}: {AUTO_SPOTS[spot]}"
    return f"{spot}: beside the {spot[3:].replace('_', ' ')}" if spot.startswith("at_") else spot


def actions_menu(catalog) -> list[str]:
    """One line per engine action: id(params): what it shows."""
    return [f"{a['id']}({', '.join(p for p in a['params'] if p != 'actor')}): {a['text']}" for a in catalog["actions"]]


def schema() -> dict:
    spot = {"type": "object", "properties": {"who": {"type": "string"}, "spot": {"type": "string"}}, "required": ["who", "spot"], "additionalProperties": False}
    enter = {"type": "object", "properties": {"who": {"type": "string"}, "line": {"type": "integer"}, "spot": {"type": "string"}}, "required": ["who", "line", "spot"], "additionalProperties": False}
    act = {"type": "object", "properties": {"action": {"type": "string"}, "who": {"type": "string"}, "target": {"type": "string"}, "object": {"type": "string"}},
           "required": ["action", "who", "target", "object"], "additionalProperties": False}
    move = {"type": "object", "properties": {"who": {"type": "string"}, "to": {"type": "string"}}, "required": ["who", "to"], "additionalProperties": False}
    line = {"type": "object", "properties": {"line": {"type": "integer"}, "do": {"type": "array", "items": act}, "move": {"type": "array", "items": move}},
            "required": ["line", "do", "move"], "additionalProperties": False}
    part = {"type": "object", "properties": {"part": {"type": "integer"}, "start": {"type": "array", "items": spot}, "enter": {"type": "array", "items": enter},
            "lines": {"type": "array", "items": line}}, "required": ["part", "start", "enter", "lines"], "additionalProperties": False}
    return {"type": "object", "properties": {"parts": {"type": "array", "items": part}}, "required": ["parts"], "additionalProperties": False}


class Checker:
    """Turns one part of the model's answer into a Plan the engine can play."""

    def __init__(self, catalog, people: dict[str, str], spots: list[str], n_lines: int):
        self.actions = {a["id"]: a for a in catalog["actions"]}
        self.people = people  # actor id -> kind
        self.spots = set(spots)
        self.n = n_lines

    def plan(self, part: dict) -> Plan:
        p = Plan()
        taken: set[str] = set()
        for s in part.get("start", []):
            if self._placeable(s["who"], s["spot"], taken, p):
                p.start[s["who"]] = s["spot"]
                taken.add(s["spot"])
            else:
                p.dropped += 1
        for e in part.get("enter", []):
            if self._placeable(e["who"], e["spot"], taken, p) and 0 <= e["line"] < self.n:
                p.enter[e["who"]] = (e["line"], e["spot"])
                taken.add(e["spot"])
            else:
                p.dropped += 1
        for ln in part.get("lines", []):
            i = ln.get("line")
            if not isinstance(i, int) or not 0 <= i < self.n:
                p.dropped += len(ln.get("do", [])) + len(ln.get("move", []))
                continue
            beats = [b for b in (self._move(m, p, i) for m in ln.get("move", [])) if b] + [b for b in (self._act(a, p, i) for a in ln.get("do", [])) if b]
            p.dropped += len(ln.get("do", [])) + len(ln.get("move", [])) - len(beats)
            if beats:
                p.lines[i] = beats
        return p

    def _placeable(self, who: str, spot: str, taken: set[str], p: Plan) -> bool:
        return who in self.people and who not in p.start and who not in p.enter and spot in self.spots and spot != "auto_entry" and (spot.startswith("at_") or spot not in taken)

    def _here(self, who: str, p: Plan, line: int) -> bool:
        return who in p.start or (who in p.enter and p.enter[who][0] <= line)

    def _move(self, m: dict, p: Plan, line: int) -> dict | None:
        to = m.get("to", "")
        if not self._here(m.get("who", ""), p, line) or to == m.get("who"):
            return None
        if to in self.spots and to not in ("auto_entry", "auto_threat") or (to in self.people and self._here(to, p, line)):
            return {"move": m["who"], "to": to}
        return None

    def _act(self, a: dict, p: Plan, line: int) -> dict | None:
        spec, who = self.actions.get(a.get("action", "")), a.get("who", "")
        if not spec or not self._here(who, p, line):
            return None
        if self.people[who] not in HANDED_KINDS and spec["id"] not in CREATURE_ACTIONS:
            return None
        beat = {"act": spec["id"], "actor": who}
        if "target" in spec["params"]:
            t = a.get("target", "")
            if t == who or t not in self.people or not self._here(t, p, line):
                return None
            beat["target"] = t
        if "object" in spec["params"]:
            beat["object"] = a.get("object") or "it"
        return beat
