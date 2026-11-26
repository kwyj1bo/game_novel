"""Blocking and acting: where each character stands, who walks in or leaves
when, and how every shown line is performed.

The rules put everyone on numbered spots in order of appearance, turn verbs
into actions ("go", "move", "come" all become `approach`) and leave most
lines unacted. Here the model reads the shown lines of each scene with the
place's spots, the people who could be there, the engine's actions and
animation clips, and answers with a staging plan: spots, entrances and
exits, and per line a camera shot, looks, moves, actions, the speaker's
gesture and mood, and the listeners' reactions.

Every part of the plan is checked against what the engine has: a spot that
does not exist, a person who is not in the scene at that line, an action a
creature cannot do or an unknown clip is dropped, and the rules fill the gap.
"""

from dataclasses import dataclass, field

from ..analyze import CREATURE_ACTIONS, HANDED_KINDS

SYSTEM = (
    "You are the director of a 3D game made from a novel. Stage each scene part like a play, so that a player "
    "who watches without reading would still follow it. For each part you get the place, its spots, the people "
    "who may be there and the numbered lines the player will see.\n"
    "Decide who is physically present at the start and on which spot, who walks in (at which line, to which "
    "spot) and who leaves. Leave out people who are only mentioned or remembered. Put people who talk to each "
    "other on nearby spots, people at a fire, table or bed by that prop, and monsters on the threat spot.\n"
    "Then act every line: what the text says happens must be seen. A speaker faces the person they talk to and "
    "gestures when the line calls for it (points at what they mention, nods to agree, shakes their head to "
    "refuse, waves to greet, laughs at a joke, cowers when afraid), and their line gets a mood. Listeners react "
    "(nod, laugh, shake, cower). Narration that describes movement or an action plays it: someone runs to "
    "another, takes or gives a thing, falls, hides. Choose a camera shot that frames what matters: close on a "
    "face for a strong line, two for a conversation, over a shoulder, low on a monster, wide for arrivals.\n"
    "Use only the listed spots, actions, clips and shots. Keep it believable: one or two clear things per line, "
    "nobody moving without a reason."
)
AUTO_SPOTS = {
    "auto_1": "front centre", "auto_2": "left of centre", "auto_3": "right of centre",
    "auto_4": "far left", "auto_5": "far right", "auto_threat": "back of the room, facing everyone (for monsters)",
    "auto_entry": "the way in (people arrive and leave here)",
}  # fmt: skip
GROUP_SPOTS = ["auto_1", "auto_2", "auto_3", "auto_4", "auto_5"]
HUMAN_CLIPS = ["nod", "shake", "point", "wave", "laugh", "cower", "reach", "celebrate", "kneel", "jump", "stagger", "lean", "sit", "struggle", "push", "fall"]
BEAST_CLIPS = ["roar", "lunge", "fall", "nod", "shake", "cower", "jump", "sleep"]  # what Beast.ts animates
MOODS = ["calm", "urgent", "scared", "angry", "whisper"]
SHOTS = ["wide", "close", "medium", "two", "over", "low", "high"]


@dataclass
class Plan:
    start: dict[str, str] = field(default_factory=dict)  # actor -> spot
    enter: dict[str, tuple[int, str]] = field(default_factory=dict)  # actor -> (line, spot)
    exits: dict[str, int] = field(default_factory=dict)  # actor -> line they leave after
    lines: dict[int, list[dict]] = field(default_factory=dict)  # line -> beats before its text
    say: dict[int, dict] = field(default_factory=dict)  # line -> extra fields for the say beat
    after: dict[int, list[dict]] = field(default_factory=dict)  # line -> beats after its text
    dropped: int = 0  # suggestions that failed the checks
    why: list[str] = field(default_factory=list)  # what each dropped suggestion was
    pos: dict[str, str | None] = field(default_factory=dict)  # where each person stands now (None: beside someone)

    @property
    def cast(self) -> list[str]:
        return [*self.start, *self.enter]

    @property
    def kept(self) -> int:
        return len(self.start) + len(self.enter) + len(self.exits) + sum(len(b) for b in self.lines.values()) + len(self.say)

    def framed(self, line: int) -> bool:
        return any("camera" in b for b in self.lines.get(line, []))


def spots_of(location: str, catalog, places: dict) -> list[str]:
    if location in catalog["locations"]:
        return list(catalog["locations"][location]["marks"])
    preset = (places.get(location) or {}).get("preset", {})
    return [*AUTO_SPOTS, *dict.fromkeys(f"at_{p['kind']}" for p in preset.get("props", []))]


def describe(spot: str) -> str:
    if spot in AUTO_SPOTS:
        return f"{spot}: {AUTO_SPOTS[spot]}"
    return f"{spot}: beside the {spot[3:].replace('_', ' ')}" if spot.startswith("at_") else spot


def actions_menu(catalog) -> dict:
    """What the model may use: actions (id(params): what it shows), clips, moods and shots."""
    return {
        "actions": [f"{a['id']}({', '.join(p for p in a['params'] if p != 'actor')}): {a['text']}" for a in catalog["actions"]],
        "human_clips": HUMAN_CLIPS, "creature_clips": BEAST_CLIPS, "moods": MOODS, "shots": SHOTS,
    }  # fmt: skip


def schema() -> dict:
    def obj(props: dict) -> dict:
        return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}

    s, i, b = {"type": "string"}, {"type": "integer"}, {"type": "boolean"}
    arr = lambda x: {"type": "array", "items": x}  # noqa: E731
    line = obj({
        "line": i,
        "shot": obj({"type": s, "on": s, "with": s}),
        "look": arr(obj({"who": s, "at": s})),
        "move": arr(obj({"who": s, "to": s, "run": b})),
        "do": arr(obj({"action": s, "who": s, "target": s, "object": s})),
        "gesture": s, "mood": s,
        "react": arr(obj({"who": s, "clip": s})),
        "exit": arr(s),
    })  # fmt: skip
    part = obj({"part": i, "start": arr(obj({"who": s, "spot": s})), "enter": arr(obj({"who": s, "line": i, "spot": s})), "lines": arr(line)})
    return obj({"parts": arr(part)})


class Checker:
    """Turns one part of the model's answer into a Plan the engine can play."""

    def __init__(self, catalog, people: dict[str, str], spots: list[str], speakers: dict[int, str | None]):
        self.actions = {a["id"]: a for a in catalog["actions"]}
        self.people = people  # actor id -> kind
        self.spots = set(spots)
        self.speakers = speakers  # line -> speaking actor (None for narration)
        self.n = len(speakers)

    def plan(self, part: dict) -> Plan:
        p = Plan()
        taken: set[str] = set()
        for s in part.get("start", []):
            spot = self._spot(s["who"], s["spot"], taken, p)
            p.dropped += spot is None
            p.why += [] if spot else [f"start {s['who']}@{s['spot']}"]
            if spot:
                p.start[s["who"]] = spot
                taken.add(spot)
        for e in part.get("enter", []):
            spot = self._spot(e["who"], e["spot"], taken, p) if 0 <= e["line"] < self.n else None
            p.dropped += spot is None
            p.why += [] if spot else [f"enter {e['who']}@{e['spot']}"]
            if spot:
                p.enter[e["who"]] = (e["line"], spot)
                taken.add(spot)
        p.pos = {**p.start, **{w: s for w, (_, s) in p.enter.items()}}
        for ln in sorted(part.get("lines", []), key=lambda x: x.get("line", -1)):
            if isinstance(ln.get("line"), int) and 0 <= ln["line"] < self.n:
                self._line(ln, p)
            else:
                p.dropped += 1
        return p

    def _line(self, ln: dict, p: Plan) -> None:
        i, here = ln["line"], lambda who: self._here(who, p, ln["line"])
        before: list[dict] = []
        shot = ln.get("shot") or {}
        if shot.get("type") in SHOTS:
            cam = {"camera": shot["type"]}
            for k in ("on", "with"):
                if shot.get(k) and here(shot[k]):
                    cam[k] = shot[k]
            before.append({**cam, "ms": 600})
        for x in ln.get("look", []):
            ok = here(x["who"]) and x["at"] != x["who"] and (here(x["at"]) or x["at"] in self.spots)
            self._keep(p, ok, before, {"look": x["who"], "at": x["at"]}, x)
        for m in ln.get("move", []):
            if m.get("to") and p.pos.get(m.get("who")) == m["to"]:
                continue  # already there
            beat = self._move(m, here, p)
            self._keep(p, beat is not None, before, beat, {"move": m})
        for a in ln.get("do", []):
            beat = self._act(a, here)
            self._keep(p, beat is not None, before, beat, a)
        for r in ln.get("react", []):
            ok = here(r["who"]) and r["clip"] in self._clips(r["who"])
            self._keep(p, ok, before, {"anim": r["who"], "clip": r["clip"], "async": True}, {"react": r})
        if before:
            p.lines[i] = before
        speaker = self.speakers[i]
        say = {}
        if speaker and ln.get("gesture") in self._clips(speaker):
            say["anim"] = ln["gesture"]
        if speaker and ln.get("mood") in MOODS:
            say["mood"] = ln["mood"]
        if say:
            p.say[i] = say
        for who in ln.get("exit", []):
            ok = here(who) and who not in p.exits
            p.dropped += not ok
            if ok:
                p.exits[who] = i
                p.after.setdefault(i, []).extend([{"move": who, "to": "auto_entry"}, {"despawn": who}])

    @staticmethod
    def _keep(p: Plan, ok: bool, out: list, beat, asked) -> None:
        if ok:
            out.append(beat)
        else:
            p.dropped += 1
            p.why.append(str(asked)[:120])

    def _clips(self, who: str) -> list[str]:
        return HUMAN_CLIPS if self.people.get(who) == "human" else BEAST_CLIPS

    def _spot(self, who: str, spot: str, taken: set[str], p: Plan) -> str | None:
        """The spot a person starts on or walks to. The door, a taken spot or
        an unknown one becomes the next free spot in the group (people who
        walk in still come through the door)."""
        if who not in self.people or who in p.start or who in p.enter:
            return None
        if spot in self.spots and spot != "auto_entry" and (spot.startswith("at_") or spot not in taken):
            return spot
        return next((s for s in GROUP_SPOTS if s in self.spots and s not in taken), None)

    def _here(self, who: str, p: Plan, line: int) -> bool:
        arrived = who in p.start or (who in p.enter and p.enter[who][0] <= line)
        return arrived and not (who in p.exits and p.exits[who] < line)

    def _move(self, m: dict, here, p: Plan) -> dict | None:
        """A walk to a spot or a person. Two people never share a spot: a
        walk to a taken spot ends beside whoever stands there."""
        who, to = m.get("who", ""), m.get("to", "")
        if not here(who) or to == who:
            return None
        if to in self.spots and to != "auto_threat":
            there = next((w for w, s in p.pos.items() if s == to and w != who and here(w)), None)
            if there:
                to = there
        elif not (to in self.people and here(to)):
            return None
        p.pos[who] = to if to in self.spots else None
        return {"move": who, "to": to, **({"run": True} if m.get("run") else {})}

    def _act(self, a: dict, here) -> dict | None:
        spec, who = self.actions.get(a.get("action", "")), a.get("who", "")
        if not spec or not here(who):
            return None
        if self.people[who] not in HANDED_KINDS and spec["id"] not in CREATURE_ACTIONS:
            return None
        beat = {"act": spec["id"], "actor": who}
        if "target" in spec["params"]:
            t = a.get("target", "")
            if t == who or t not in self.people or not here(t):
                return None
            beat["target"] = t
        if "object" in spec["params"]:
            beat["object"] = a.get("object") or "it"
        return beat
