"""Scenes, key moments, opposite choices, and the final story JSON.

Input: an Analysis (characters + ordered lines). Output: a story dict in the
engine's format. Every decision is a rule; the same input always gives the
same story.
"""

import hashlib
import re
from dataclasses import dataclass, field

from . import lexicon as L
from .analyze import Analysis, Character, Event, Line, QUOTE_RE

MAX_NARRATION_PER_SCENE = 14
MAX_CHOICES = 3


@dataclass
class Scene:
    location: str
    lines: list[Line] = field(default_factory=list)


@dataclass
class Moment:
    line: int  # index into Analysis.lines
    event: Event
    correct: str
    opposite: str
    score: float


def _h(text: str) -> int:
    return int(hashlib.sha1(text.encode()).hexdigest()[:8], 16)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "story"


# ---- scenes ----------------------------------------------------------------


def _location_hits(text: str, catalog) -> dict[str, int]:
    """Keyword hits per location in narration (dialogue is ignored: a place
    talked about is not a place you are in)."""
    narration = QUOTE_RE.sub(" ", text).lower()
    hits = {}
    for lid, loc in catalog["locations"].items():
        # Multi-word keywords ("great hall") are stronger evidence than one word.
        n = sum(len(re.findall(rf"\b{re.escape(k.lower())}s?\b", narration)) * len(k.split()) for k in loc["keywords"])
        if n:
            hits[lid] = n
    return hits


def segment(paragraphs: list[str], lines: list[Line], catalog) -> list[Scene]:
    fallback = catalog.get("defaultScenery") or next(iter(catalog["locations"]))
    hits = [_location_hits(p, catalog) for p in paragraphs]
    opening: dict[str, int] = {}
    for h in hits[:4]:
        for k, v in h.items():
            opening[k] = opening.get(k, 0) + v
    current = max(opening, key=opening.get) if opening else fallback

    starts: dict[int, str] = {0: current}
    for i, p in enumerate(paragraphs):
        if i == 0:
            continue
        low = p.lower().strip()
        new_loc = None
        h = hits[i]
        top = max(h, key=h.get) if h else None
        if p.strip() in L.SCENE_SEPARATORS or low.startswith(L.TIME_MARKERS):
            new_loc = top or current
        elif top and top != current and (h[top] >= 2 or re.search(rf"\binto the [\w' ]*\b({'|'.join(catalog['locations'][top]['keywords'])})", low)):
            new_loc = top
        if new_loc is not None:
            target = i + 1 if p.strip() in L.SCENE_SEPARATORS else i
            # A separator's location is decided by what follows it.
            if p.strip() in L.SCENE_SEPARATORS and target < len(hits) and hits[target]:
                new_loc = max(hits[target], key=hits[target].get)
            starts[target] = new_loc
            current = new_loc

    scenes: list[Scene] = []
    by_para: dict[int, list[Line]] = {}
    for ln in lines:
        by_para.setdefault(ln.para, []).append(ln)
    loc = starts[0]
    scene = Scene(location=loc)
    for i in range(len(paragraphs)):
        if i in starts and i != 0:
            if scene.lines:
                scenes.append(scene)
            scene = Scene(location=starts[i])
        scene.lines.extend(by_para.get(i, []))
    if scene.lines:
        scenes.append(scene)
    return scenes


# ---- moments and opposites -------------------------------------------------


def _strip_article(obj: str) -> tuple[str, bool]:
    m = re.match(r"^(the|a|an|this|that|your)\s+(.*)$", obj, re.IGNORECASE)
    return (m.group(2), True) if m else (obj, False)


def opposite(event: Event, chars: dict[str, Character]) -> str:
    """The direct opposite of what the hero did, as an instruction."""
    if event.kind == "move" and event.target in chars:
        t = chars[event.target]
        who = f"the {t.name.lower()}" if t.kind != "human" else t.name
        if who.startswith("The "):
            who = who.lower()  # unnamed people: "the sailor"
        return f"Keep away from {who}"
    if event.kind == "move" and event.target == "away":
        return "Stand your ground"
    obj_head = event.obj.split()[-1].lower() if event.obj else ""
    if (event.verb, obj_head) in L.OPPOSITES_WITH:
        return L.OPPOSITES_WITH[(event.verb, obj_head)]
    template = L.OPPOSITES.get(event.verb)
    if template:
        if "{obj}" not in template:
            return template
        core, had_article = _strip_article(event.obj) if event.obj else ("it", False)
        if not event.obj:
            return template.replace("the {obj}", "it").replace("{obj}", "it")
        if not had_article:
            return template.replace("the {obj}", core).replace("{obj}", core)
        return template.replace("{obj}", core)
    ant = _wordnet_antonym(event.verb)
    if ant:
        rest = event.phrase.split(" ", 1)[1] if " " in event.phrase else ""
        return f"{ant.capitalize()} {rest}".strip()
    return "Don't " + event.phrase[:1].lower() + event.phrase[1:]


def _wordnet_antonym(verb: str) -> str | None:
    try:
        from nltk.corpus import wordnet as wn
    except ImportError:
        return None
    for syn in wn.synsets(verb, pos="v"):
        for lemma in syn.lemmas():
            for ant in lemma.antonyms():
                return ant.name().replace("_", " ")
    return None


def _as_infinitive(instruction: str) -> str:
    """'Leave the door locked' -> 'to leave the door locked'; "Don't x" -> 'not to x'."""
    if instruction.startswith("Don't "):
        return "not to " + instruction[6:]
    return "to " + instruction[:1].lower() + instruction[1:]


VERB_WEIGHT = {"unlock": 2.0, "open": 1.5, "enter": 1.5, "jump": 1.5, "attack": 2.0, "run": 1.5, "grab": 1.2, "cast": 2.0, "save": 2.0, "help": 1.5, "pick": 1.3, "close": 1.3, "throw": 1.3, "step": 1.0}


def find_moments(a: Analysis, scenes: list[Scene]) -> list[Moment]:
    hero = a.protagonist
    if not hero:
        return []
    n = len(a.lines)
    scene_of = {}
    for si, sc in enumerate(scenes):
        for ln in sc.lines:
            scene_of[id(ln)] = si
    creatures_in = []
    for sc in scenes:
        names = {e.actor for ln in sc.lines for e in ln.events} | {ln.speaker for ln in sc.lines}
        creatures_in.append(any(c in a.characters and a.characters[c].kind != "human" for c in names))

    cands: list[Moment] = []
    for i, ln in enumerate(a.lines):
        # Leave room for setup before the first choice and an aftermath after the last.
        if i < 3 or i > n - 2:
            continue
        for ev in ln.events:
            if ev.actor != hero or not ev.phrase:
                continue
            toward_threat = ev.kind == "move" and ev.target in a.characters and a.characters[ev.target].kind != "human"
            if ev.verb not in L.DECISIVE_VERBS and not toward_threat:
                continue
            window = a.lines[max(0, i - 4) : i + 3]
            tension = sum(w.danger for w in window) / max(1, len(window))
            score = tension + VERB_WEIGHT.get(ev.verb, 0.8) + (1.5 if toward_threat else 0) + (1.0 if creatures_in[scene_of[id(ln)]] else 0) + 1.5 * i / n
            correct = ev.phrase
            if toward_threat:
                t = a.characters[ev.target]
                correct = f"{ev.verb.capitalize()} at the {t.name.lower()}" if ev.verb in ("run", "charge", "rush") else ev.phrase
            cands.append(Moment(line=i, event=ev, correct=correct, opposite=opposite(ev, a.characters), score=score))
    k = min(MAX_CHOICES, max(1, n // 20))
    chosen: list[Moment] = []
    for m in sorted(cands, key=lambda m: -m.score):
        if all(abs(m.line - c.line) >= 6 for c in chosen):
            chosen.append(m)
        if len(chosen) == k:
            break
    return sorted(chosen, key=lambda m: m.line)


# ---- assembly --------------------------------------------------------------

ROBES = ["#2a2238", "#1f3a4a", "#3a2a1a", "#2e3a24", "#4a1f24", "#22262e", "#3a3044"]
SKINS = ["#f0cdb2", "#e3b08c", "#dca47e", "#c98e66", "#a8714c", "#7a5038"]
HAIRS = ["#120d08", "#3a2414", "#5a3418", "#8a5a2a", "#c2501e", "#d8c080", "#6a6a6a"]
SUBS = ["#f3d27a", "#ff9a6a", "#c9a8ff", "#8fd6a8", "#8ac8ff", "#ffb0c8", "#e0e0e0"]


def actor_spec(c: Character, catalog) -> dict:
    """The manifest's look for this character, or a generated one."""
    if c.kind != "human":
        base = dict(catalog["creatures"][c.asset]["spec"]) if c.asset in catalog["creatures"] else {"kind": c.kind, "height": 3}
        base["name"] = c.name
        return base
    if c.asset in catalog["characters"]:
        return dict(catalog["characters"][c.asset]["spec"])
    h = _h(c.id)
    female = c.gender == "f"
    styles = ["bushy", "long", "bun"] if female else ["short", "messy", "ginger_mop"]
    return {
        "name": c.name,
        "height": round(1.5 + (h % 30) / 100, 2),
        "robe": ROBES[h % len(ROBES)],
        "skin": SKINS[(h >> 3) % len(SKINS)],
        "hair": HAIRS[(h >> 6) % len(HAIRS)],
        "hairStyle": styles[(h >> 9) % len(styles)],
        "outfit": "adult",
        "voice": 1.35 if female else 0.95,
        "subtitleColor": SUBS[(h >> 12) % len(SUBS)],
    }


class _Assembler:
    def __init__(self, a: Analysis, catalog, chapter_title: str, source: str):
        self.a = a
        self.cat = catalog
        self.title = chapter_title
        self.source = source
        self.chars = a.characters
        self.hero = a.protagonist
        self._last_speaker: str | None = None

    def name(self, cid: str | None) -> str:
        return self.chars[cid].name if cid in self.chars else "someone"

    def present(self, lines: list[Line]) -> list[str]:
        """Characters in these lines, in order of first appearance."""
        seen: list[str] = []

        def add(cid):
            if cid in self.chars and cid not in seen:
                seen.append(cid)

        for ln in lines:
            add(ln.speaker)
            for e in ln.events:
                add(e.actor)
                if e.target in self.chars:
                    add(e.target)
            # Being talked about in dialogue does not put someone in the room.
            if ln.kind != "narrate":
                continue
            for cid, c in self.chars.items():
                if re.search(rf"\b{re.escape(c.name.split()[-1])}\b", ln.text, re.IGNORECASE):
                    add(cid)
        return seen

    def _involves(self, ln: Line, cid: str) -> bool:
        if any(e.actor == cid for e in ln.events):
            return True
        c = self.chars[cid]
        return ln.kind == "narrate" and bool(re.search(rf"\b{re.escape(c.name.split()[-1])}\b", ln.text, re.IGNORECASE))

    def cast(self, ids: list[str], entering: set[str]) -> tuple[dict, dict]:
        """Initial cast (mark per actor) and the slot each actor will use."""
        slots: dict[str, str] = {}
        humans = [c for c in ids if self.chars[c].kind == "human"]
        if self.hero in humans:
            humans.remove(self.hero)
            humans.insert(0, self.hero)
        for i, c in enumerate(humans[:5]):
            slots[c] = f"auto_{i + 1}"
        for c in ids:
            if self.chars[c].kind != "human":
                slots[c] = "auto_threat"
        cast = {c: m for c, m in slots.items() if c not in entering}
        return cast, slots

    def beats(self, lines: list[Line], slots: dict, on_stage: set[str], first_beats: list) -> list:
        out = list(first_beats)
        last_cam = None
        last_speaker = self._last_speaker
        narrations = 0
        for ln in lines:
            actions: list = []
            for e in ln.events:
                actions.extend(self.event_beats(e, slots, on_stage))
            if ln.kind == "say" and ln.speaker in on_stage:
                if ln.speaker != last_cam:
                    # Turn to whoever they're talking to first, so the close-up sees their face.
                    listener = last_speaker if last_speaker in on_stage and last_speaker != ln.speaker else next((c for c in on_stage if c != ln.speaker and self.chars[c].kind == "human"), None)
                    if listener:
                        out.append({"look": ln.speaker, "at": listener})
                    out.append({"camera": "close" if len(ln.text) < 70 else "medium", "on": ln.speaker, "ms": 500})
                    last_cam = ln.speaker
                last_speaker = ln.speaker
                out.extend(actions)
                beat = {"say": ln.speaker, "text": ln.text}
                if ln.mood:
                    beat["mood"] = ln.mood
                out.append(beat)
                continue
            if ln.kind == "say":
                out.extend(actions)
                out.append({"narrate": f"“{ln.text}”"})
                continue
            focus = next((e.actor for e in ln.events if e.actor in on_stage and e.kind in ("anim", "move")), None)
            if focus and focus != last_cam:
                out.append({"camera": "medium", "on": focus, "ms": 700})
                last_cam = focus
            elif not focus and last_cam is not None:
                # Narration about the room: leave the close-up.
                out.append({"camera": "wide", "ms": 900})
                last_cam = None
            out.extend(actions)
            if narrations < MAX_NARRATION_PER_SCENE or ln.events:
                out.append({"narrate": _trim(ln.text)})
                narrations += 1
        self._last_speaker = last_speaker
        return out

    def event_beats(self, e: Event, slots: dict, on_stage: set[str]) -> list:
        if e.kind == "sound" and e.sfx in self.cat["sfx"]:
            return [{"sfx": e.sfx}]
        if e.actor not in on_stage:
            return []
        if e.kind == "anim" and e.clip:
            beat = {"anim": e.actor, "clip": e.clip, "async": True}
            if e.clip in ("fall", "kneel", "sleep"):
                beat["hold"] = True
            return [beat]
        if e.kind == "move":
            if e.target == "away":
                return [{"move": e.actor, "to": "auto_entry", "run": True, "async": True}]
            if e.target in on_stage and e.target != e.actor:
                return [{"move": e.actor, "to": e.target, "run": e.run, "async": not e.run}]
            return []
        if e.kind == "spell":
            target = next((c for c in on_stage if self.chars[c].kind != "human"), None) or next((c for c in on_stage if c != e.actor), None)
            beats = [{"anim": e.actor, "clip": "cast"}]
            if target:
                beats.append({"fx": "spell", "from": e.actor, "to": target, "color": "#ffe08a"})
            return beats
        return []

    def build(self, scenes: list[Scene], moments: list[Moment]) -> dict:
        a = self.a
        index_of = {id(ln): i for i, ln in enumerate(a.lines)}
        # Split scenes at each moment: before (ends in the choice), after (continues).
        parts: list[tuple[Scene, Moment | None]] = []
        for sc in scenes:
            cur = Scene(location=sc.location)
            for ln in sc.lines:
                m = next((m for m in moments if m.line == index_of[id(ln)]), None)
                if m:
                    parts.append((cur, m))
                    cur = Scene(location=sc.location)
                cur.lines.append(ln)
            parts.append((cur, None))

        story_scenes: dict[str, dict] = {}
        used: set[str] = set()
        on_stage: set[str] = set()
        prev_loc = None
        ids = [f"scene_{i + 1}" for i in range(len(parts))]
        for pi, (sc, moment) in enumerate(parts):
            sid = ids[pi]
            new_loc = sc.location != prev_loc
            if new_loc:
                on_stage = set()
            # The protagonist is the point of view: always in the room.
            present = self.present(sc.lines)
            if self.hero and self.hero not in present:
                present.insert(0, self.hero)
            # Who walks in mid-scene: first seen in a move into the room.
            entering = set()
            # A creature arrives at its first action rather than waiting in the room.
            first_seen: dict[str, int] = {}
            for c in present:
                if self.chars[c].kind != "human" and c not in on_stage:
                    seen = next((i for i, ln in enumerate(sc.lines) if self._involves(ln, c)), None)
                    if seen is not None and seen > 1:
                        entering.add(c)
                        first_seen[c] = seen
            for ln in sc.lines:
                for e in ln.events:
                    if e.actor in present and e.actor not in on_stage and e.kind == "move" and e.verb in ("burst", "enter", "come", "hurry", "lumber", "pad", "walk", "rush"):
                        if not any(e.actor == x.speaker or e.actor in [y.actor for y in x.events] for x in sc.lines[: sc.lines.index(ln)]):
                            entering.add(e.actor)
            all_ids = list(dict.fromkeys([*on_stage, *present]))
            cast, slots = self.cast(all_ids, entering - on_stage)
            used.update(slots)
            stage = set(cast)
            first: list = []
            if new_loc:
                danger = sum(ln.danger for ln in sc.lines) / max(1, len(sc.lines))
                first += [{"camera": "wide", "ms": 0}, {"music": "tension" if danger >= 1 else "mystery"}]
            body: list = []
            # Entrances happen at the line where the character first acts.
            pending_entries = set(entering - on_stage)
            lines_out: list = []
            for li, ln in enumerate(sc.lines):
                arrivals = [e.actor for e in ln.events if e.actor in pending_entries]
                arrivals += [c for c, at in first_seen.items() if at == li and c in pending_entries and c not in arrivals]
                for actor in dict.fromkeys(arrivals):
                    if self.chars[actor].kind != "human":
                        # Creatures loom out of the far side of the room.
                        lines_out += [{"spawn": actor, "at": slots[actor]}, {"sfx": "growl"}]
                    else:
                        lines_out += [{"spawn": actor, "at": "auto_entry"}, {"move": actor, "to": slots[actor], "async": True}]
                    pending_entries.discard(actor)
                    stage.add(actor)
                lines_out += self.beats([ln], slots, stage, [])
            body = first + lines_out
            if not body:
                body = [{"camera": "wide", "ms": 0}]
            scene: dict = {"location": sc.location, "cast": cast, "beats": body}
            if new_loc:
                scene["title"] = self.cat["locations"][sc.location]["title"]
            on_stage = stage
            prev_loc = sc.location
            if moment:
                wrong_id = f"{sid}_wrong"
                story_scenes[wrong_id] = self.wrong_scene(sc.location, moment, stage, slots)
                options = [
                    {"label": moment.correct, "correct": True, "goto": ids[pi + 1]},
                    {"label": moment.opposite, "correct": False, "goto": wrong_id},
                ]
                if _h(moment.correct) % 2:
                    options.reverse()
                scene["beats"].append({"camera": "close", "on": self.hero, "ms": 600})
                scene["choice"] = {"prompt": f"What should {self.name(self.hero)} do?", "seconds": 10, "options": options}
            elif pi + 1 < len(parts):
                scene["goto"] = ids[pi + 1]
            else:
                scene["ending"] = {
                    "kind": "victory",
                    "title": self.title,
                    "text": f"You followed {self.name(self.hero)} through “{self.title}” the way the book tells it.",
                }
            story_scenes[sid] = scene

        actors = {c: actor_spec(self.chars[c], self.cat) for c in used}
        return {
            "$schema": "../../../story.schema.json",
            "id": _slug(f"{self.source}-{self.title}"),
            "title": self.title,
            "subtitle": self.source,
            "start": ids[0],
            "actors": actors,
            "scenes": story_scenes,
        }

    def wrong_scene(self, location: str, m: Moment, stage: set[str], slots: dict) -> dict:
        hero = self.hero
        threat = next((c for c in stage if self.chars[c].kind != "human"), None)
        beats: list = [{"camera": "medium", "on": hero, "ms": 500}, {"narrate": f"{self.name(hero)} hesitates — and chooses {_as_infinitive(m.opposite)}."}]
        if m.event.kind == "move" and m.event.target and m.event.target != "away":
            beats.append({"move": hero, "to": "auto_entry", "async": True})
        if threat:
            kind = self.chars[threat].kind
            beats += [{"camera": "low", "on": threat, "ms": 600}, {"sfx": "roar"}]
            if kind in ("troll", "dog3"):
                beats.append({"anim": threat, "clip": "roar"})
            beats += [
                {"together": [{"anim": threat, "clip": "lunge"}, {"fx": "shake", "ms": 700}]},
                {"together": [{"anim": hero, "clip": "fall", "hold": True}, {"sfx": "thud"}]},
                {"fx": "red_out", "ms": 1500},
            ]
            kind_out = "death"
        else:
            beats += [{"anim": hero, "clip": "shake"}, {"narrate": "The moment slips away, and it cannot be taken back."}, {"fx": "fade_out", "ms": 1500}]
            kind_out = "failure"
        titles = ["The Other Path", "Wrong Turn", "Not How It Happened", "A Different Ending"]
        return {
            "location": location,
            "cast": {c: slots.get(c, "auto_1") for c in stage},
            "beats": beats,
            "ending": {
                "kind": kind_out,
                "title": titles[_h(m.opposite) % len(titles)],
                "text": f"In the book, {self.name(hero)} chose {_as_infinitive(m.correct)}. Choosing {_as_infinitive(m.opposite)} ended the story here.",
            },
        }


def _trim(text: str, limit: int = 240) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(",", 1)[0] if "," in text[:limit] else text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;") + "…"


def build_story(paragraphs: list[str], a: Analysis, catalog, chapter_title: str, source: str):
    """Scenes and choices come from the whole chapter; what the game shows is
    only the event chain (the important events, in order)."""
    from .events import build_chain

    scenes = segment(paragraphs, a.lines, catalog)
    moments = find_moments(a, scenes)
    chain = build_chain(a, scenes, moments)
    shown = {id(ln) for node in chain for ln in node.lines}
    condensed = [Scene(location=sc.location, lines=[ln for ln in sc.lines if id(ln) in shown]) for sc in scenes]
    condensed = [sc for sc in condensed if sc.lines]
    story = _Assembler(a, catalog, chapter_title, source).build(condensed, moments)
    return story, condensed, moments, chain
