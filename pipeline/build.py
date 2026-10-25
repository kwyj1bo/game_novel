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
    # Manifest action performed when the wrong option is picked, if any.
    opposite_action: str | None = None


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


# A scene whose place no manifest keyword names. It gets an AI-made place
# when there is one, otherwise the default scenery.
UNPLACED = "?"


def place_key(sc: "Scene") -> str:
    """Identifies an unplaced scene across builds (by its first line)."""
    return hashlib.sha1(sc.lines[0].text.encode()).hexdigest()[:12]


MIN_SCENE = 6  # paragraphs; shorter detours merge into their neighbours
ARRIVAL_RE = r"\b(into|entered|enter|reached|arrived (?:at|in)|inside|back to|out (?:of|into))\b[\w' ,-]{0,40}?\b"


def segment(paragraphs: list[str], lines: list[Line], catalog) -> list[Scene]:
    """Splits a chapter into scenes by location. Real chapters mention places
    in passing ("a lesson", "the kitchen"), so a move needs evidence: a scene
    break or time jump, an arrival phrase ("into the Great Hall"), or the new
    place staying in the narration for the next few paragraphs."""
    fallback = UNPLACED
    hits = [_location_hits(p, catalog) for p in paragraphs]
    order = {lid: i for i, lid in enumerate(catalog["locations"])}

    def top_of(window: list[dict[str, int]]) -> tuple[str | None, int, int]:
        """Best location over some paragraphs: (id, total hits, paragraphs it appears in).
        Ties go to the scenery listed first in the manifest."""
        total: dict[str, int] = {}
        seen: dict[str, int] = {}
        for h in window:
            for k, v in h.items():
                total[k] = total.get(k, 0) + v
                seen[k] = seen.get(k, 0) + 1
        if not total:
            return None, 0, 0
        best = max(total, key=lambda k: (total[k], -order[k]))
        return best, total[best], seen[best]

    # Where the chapter opens: the first paragraphs that name a place.
    current = top_of(hits[:3])[0] or top_of(hits[:10])[0] or fallback
    starts: dict[int, str] = {0: current}
    last_start = 0
    for i, p in enumerate(paragraphs):
        if i == 0:
            continue
        low = p.lower().strip()
        is_break = p.strip() in L.SCENE_SEPARATORS or low.startswith(L.TIME_MARKERS)
        top, n, _ = top_of([hits[i]])
        new_loc = None
        if is_break:
            ahead = hits[i + 1 : i + 5] if p.strip() in L.SCENE_SEPARATORS else hits[i : i + 4]
            new_loc = top_of(ahead)[0] or current
        elif top and top != current:
            kws = "|".join(re.escape(k.lower()) for k in catalog["locations"][top]["keywords"])
            arrival = re.search(ARRIVAL_RE + rf"({kws})s?\b", re.sub(r"[“\"][^”\"]*[”\"]", " ", low))
            w_top, w_n, w_paras = top_of(hits[i : i + 4])
            here = sum(h.get(current, 0) for h in hits[i : i + 4])
            sustained = w_top == top and w_n >= 3 and w_paras >= 2 and w_n > here
            if (arrival or sustained) and (i - last_start >= MIN_SCENE or arrival):
                new_loc = top
        if new_loc is not None and new_loc != current or is_break:
            target = i + 1 if p.strip() in L.SCENE_SEPARATORS else i
            starts[target] = new_loc or current
            current = new_loc or current
            last_start = target

    scenes: list[Scene] = []
    by_para: dict[int, list[Line]] = {}
    for ln in lines:
        by_para.setdefault(ln.para, []).append(ln)
    scene = Scene(location=starts[0])
    for i in range(len(paragraphs)):
        if i in starts and i != 0 and starts[i] != scene.location:
            if scene.lines:
                scenes.append(scene)
            scene = Scene(location=starts[i])
        scene.lines.extend(by_para.get(i, []))
    if scene.lines:
        scenes.append(scene)
    # Merge neighbours that ended up in the same place.
    merged: list[Scene] = []
    for sc in scenes:
        if merged and merged[-1].location == sc.location:
            merged[-1].lines.extend(sc.lines)
        else:
            merged.append(sc)
    return merged


# ---- moments and opposites -------------------------------------------------


def display_name(cid: str | None, chars: dict[str, Character]) -> str:
    """How narration and labels name a character: "Harry", "the troll", "the innkeeper"."""
    if cid not in chars:
        return "someone"
    c = chars[cid]
    # Generic creatures are "the troll"; named ones ("Hedwig") keep their name.
    if c.kind != "human" and c.id == c.name.lower():
        return f"the {c.name.lower()}"
    return c.name.lower() if c.name.startswith("The ") else c.name


def fill_template(template: str, ev: Event, chars: dict[str, Character], for_player: bool = False) -> str:
    """An action's text or label with its parameters filled in."""
    text = template.replace("{actor}", display_name(ev.actor, chars)).replace("{target}", display_name(ev.target, chars))
    text = text.replace("{object}", (ev.obj_label if for_player else ev.obj) or "it")
    return text[:1].upper() + text[1:]


def _strip_article(obj: str) -> tuple[str, bool]:
    m = re.match(r"^(the|a|an|this|that|your)\s+(.*)$", obj, re.IGNORECASE)
    return (m.group(2), True) if m else (obj, False)


def opposite(event: Event, chars: dict[str, Character]) -> str:
    """The direct opposite of what the hero did, as an instruction."""
    if event.kind == "move" and event.target in chars:
        t = chars[event.target]
        who = display_name(event.target, chars)
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


def find_moments(a: Analysis, scenes: list[Scene], catalog) -> list[Moment]:
    actions = {x["id"]: x for x in catalog["actions"]}
    hero = a.protagonist
    if not hero:
        return []
    # A chapter where the hero barely acts (a baby on a doorstep) has no
    # decision of theirs to offer.
    h = a.characters[hero]
    if h.named_actions < 2 and not (h.named_actions and h.actions + h.spoken >= 3):
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
            act = actions.get(ev.action) if ev.kind == "action" else None
            if act and (not act.get("decision") or act.get("minor")):
                continue  # things that happen to you, or everyday business, are not choices
            opp = actions.get(act.get("opposite")) if act else None
            toward_threat = ev.action in ("approach", "run_to") and ev.target in a.characters and a.characters[ev.target].kind != "human"
            # A decision is an action with a defined opposite, or a decisive verb.
            if not opp and ev.verb not in L.DECISIVE_VERBS and not toward_threat:
                continue
            if not act and not ev.obj and "{obj}" in L.OPPOSITES.get(ev.verb, ""):
                continue  # "Grab Uncle Vernon" has no clean opposite
            window = a.lines[max(0, i - 4) : i + 3]
            tension = sum(w.danger for w in window) / max(1, len(window))
            score = tension + VERB_WEIGHT.get(ev.verb, 0.8) + (1.5 if toward_threat else 0) + (1.0 if creatures_in[scene_of[id(ln)]] else 0) + 1.5 * i / n
            if act and opp:
                # Both options are action assets: the hero's action and its opposite.
                correct = fill_template(act["label"], ev, a.characters, for_player=True)
                wrong = fill_template(opp["label"], ev, a.characters, for_player=True)
                cands.append(Moment(line=i, event=ev, correct=correct, opposite=wrong, score=score + 0.5, opposite_action=opp["id"]))
            else:
                cands.append(Moment(line=i, event=ev, correct=ev.phrase, opposite=opposite(ev, a.characters), score=score))
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


# Creatures that stand at the threat mark and attack on a wrong choice.
HOSTILE_KINDS = {"troll", "dog3", "dragon"}


def actor_spec(c: Character, catalog) -> dict:
    """The manifest's look for this character, or a generated one."""
    if c.asset in catalog["characters"]:
        return dict(catalog["characters"][c.asset]["spec"])
    if c.kind != "human":
        base = dict(catalog["creatures"][c.asset]["spec"]) if c.asset in catalog["creatures"] else {"kind": c.kind, "height": 3}
        base["name"] = c.name
        return base
    if c.look:
        return {**c.look, "name": c.name}
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
        self._last_narration = ""
        self.places: dict[str, dict] = {}  # AI-made places this story uses
        self.actions = {x["id"]: x for x in catalog["actions"]}

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
        humans = [c for c in ids if self.chars[c].kind not in HOSTILE_KINDS]
        if self.hero in humans:
            humans.remove(self.hero)
            humans.insert(0, self.hero)
        for i, c in enumerate(humans[:5]):
            slots[c] = f"auto_{i + 1}"
        for c in ids:
            if self.chars[c].kind in HOSTILE_KINDS:
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
            for e in self.story_events(ln):
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
            focus = next((e.actor for e in ln.events if e.actor in on_stage and e.kind == "action"), None)
            if focus and focus != last_cam:
                out.append({"camera": "medium", "on": focus, "ms": 700})
                last_cam = focus
            elif not focus and last_cam is not None:
                # Narration about the room: leave the close-up.
                out.append({"camera": "wide", "ms": 900})
                last_cam = None
            out.extend(actions)
            text = self.narration(ln, on_stage)
            if text and text[:1].islower():
                text = ""  # a dialogue tag cut loose ("faltered Professor McGonagall.")
            if text and text != self._last_narration and (narrations < MAX_NARRATION_PER_SCENE or ln.events):
                out.append({"narrate": text})
                self._last_narration = text
                narrations += 1
        self._last_speaker = last_speaker
        return out

    def event_beats(self, e: Event, slots: dict, on_stage: set[str]) -> list:
        if e.kind == "sound" and e.sfx in self.cat["sfx"]:
            return [{"sfx": e.sfx}]
        if e.actor not in on_stage:
            return []
        if e.kind == "action":
            beat = self.act_beat(e, on_stage)
            return [beat] if beat else []
        if e.kind == "spell":
            target = next((c for c in on_stage if self.chars[c].kind in HOSTILE_KINDS), None) or next((c for c in on_stage if c != e.actor), None)
            beats = [{"anim": e.actor, "clip": "cast"}]
            if target:
                beats.append({"fx": "spell", "from": e.actor, "to": target, "color": "#ffe08a"})
            return beats
        return []

    def act_beat(self, e: Event, on_stage: set[str], action: str | None = None) -> dict | None:
        """An "act" beat for an action asset, if its parameters are on stage."""
        aid = action or e.action
        params = self.actions[aid]["params"]
        beat: dict = {"act": aid, "actor": e.actor}
        if "target" in params:
            if e.target not in on_stage or e.target == e.actor:
                return None
            beat["target"] = e.target
        if "object" in params:
            beat["object"] = e.obj or "it"
        return beat

    def story_events(self, ln: Line) -> list[Event]:
        """The events a line plays: sounds and spells, plus its single most
        important story action and the walk-up to it. Minor everyday actions
        (sitting, nodding, glancing) never play."""
        story = [e for e in ln.events if e.kind == "action" and not self.actions[e.action].get("minor")]
        others = [e for e in ln.events if e.kind in ("sound", "spell")]
        if not story:
            return others
        main = max(story, key=lambda e: (3 if e.target else 2 if e.obj else 1, story.index(e)))
        lead_in = [e for e in story if e is not main and e.action in ("approach", "run_to") and e.actor == main.actor and e.target and e.target == main.target]
        return others + lead_in + [main]

    def narration(self, ln: Line, on_stage: set[str]) -> str:
        """What the narrator says for a line: written from the actions it holds
        ("Ron walks over to Harry. Ron pats Harry on the shoulder."), or the
        book's sentence, shortened, when no action asset matched."""
        parts = [
            fill_template(self.actions[e.action]["text"], e, self.chars)
            for e in self.story_events(ln)
            if e.kind == "action" and e.actor in on_stage and ("target" not in self.actions[e.action]["params"] or e.target in on_stage)
        ]
        return " ".join(parts) if parts else _trim(ln.text, 170)

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
                    if e.actor in present and e.actor not in on_stage and e.kind in ("move", "action") and e.verb in ("burst", "enter", "come", "hurry", "lumber", "pad", "walk", "rush"):
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
                scene["title"] = (self.cat["locations"].get(sc.location) or self.places[sc.location])["title"]
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
            **({"sceneries": self.places} if self.places else {}),
        }

    def wrong_scene(self, location: str, m: Moment, stage: set[str], slots: dict) -> dict:
        hero = self.hero
        threat = next((c for c in stage if self.chars[c].kind in HOSTILE_KINDS), None)
        beats: list = [{"camera": "medium", "on": hero, "ms": 500}]
        opp_beat = self.act_beat(m.event, stage, m.opposite_action) if m.opposite_action else None
        if opp_beat:
            # The player's choice is acted out: the opposite of what the book says.
            beats += [opp_beat, {"narrate": fill_template(self.actions[m.opposite_action]["text"], m.event, self.chars)}]
        else:
            beats.append({"narrate": f"{self.name(hero)} hesitates — and chooses {_as_infinitive(m.opposite)}."})
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
    """Shortens a book sentence to its first clause or two, so narration
    stays a summary, not a transcript."""
    for sep in ("; ", " -- ", " — "):
        if sep in text and text.index(sep) > 40:
            text = text[: text.index(sep)].rstrip(",") + "."
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(",", 1)[0] if "," in text[:limit] else text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;") + "…"


def build_story(paragraphs: list[str], a: Analysis, catalog, chapter_title: str, source: str, places: dict | None = None):
    """Scenes and choices come from the whole chapter; what the game shows is
    only the event chain (the important events, in order). `places` maps an
    unplaced scene's key to an AI-made place."""
    from .events import build_chain

    scenes = segment(paragraphs, a.lines, catalog)
    used_places: dict[str, dict] = {}
    for sc in scenes:
        if sc.location == UNPLACED:
            p = (places or {}).get(place_key(sc))
            sc.location = p["id"] if p else catalog["defaultScenery"]
            if p:
                used_places[p["id"]] = {"title": p["title"], "preset": p["preset"]}
    moments = find_moments(a, scenes, catalog)
    chain = build_chain(a, scenes, moments, catalog)
    shown = {id(ln) for node in chain for ln in node.lines}
    condensed = [Scene(location=sc.location, lines=[ln for ln in sc.lines if id(ln) in shown]) for sc in scenes]
    condensed = [sc for sc in condensed if sc.lines]
    assembler = _Assembler(a, catalog, chapter_title, source)
    assembler.places = used_places
    story = assembler.build(condensed, moments)
    return story, condensed, moments, chain
