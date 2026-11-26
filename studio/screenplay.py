"""The screenplay agent: one chapter of the novel becomes a playable script.

The model reads the chapter, its scenes from the index and the book's cast,
and writes scenes of beats: narration, dialogue, actions in plain words
("hands Harry a bag of gold coins"), entrances and exits, and the player's
choices with what happens on the wrong path. Objects that matter get an id,
so later agents can model them and pass them from hand to hand.

A checker lists every problem (an unknown person, someone acting who is not
in the scene, an object nobody defined, a choice without exactly one right
answer), and the model fixes its own answer until the script is clean.
"""

from dataclasses import dataclass

from .index import BookIndex
from .llm import B, I, S, Model, arr, obj

SYSTEM = (
    "You are a screenwriter adapting a chapter of a novel into a short interactive 3D game. Stay faithful to the "
    "book: its events, in its order, its dialogue where it has some. Keep what a player needs to follow the "
    "story and feel it: turning points, danger, discoveries, decisions, and the moments that show who people "
    "are. Leave out description and small talk the player can do without.\n"
    "Write scenes. A scene happens in one place; give the place a short id and a one-line description. List who "
    "is there when it starts (use the cast ids). Then beats, in order:\n"
    "- narrate: a short line read to the player, in the book's voice;\n"
    "- say: a line of dialogue, with who says it, to whom, and the mood;\n"
    "- do: a physical action in plain words, with who does it, to whom and with which object "
    "(\"hands Harry a heavy bag of gold coins\");\n"
    "- enter / exit: someone arrives or leaves.\n"
    "Only people present can act or speak. Give every object that is handled or important an id and a "
    "description of how it looks. Add two or three choices for the player at the chapter's real decisions: the "
    "right option is what the book's hero does; the other is a believable mistake, with two or three beats "
    "showing how it goes wrong."
)
KINDS = ("narrate", "say", "do", "enter", "exit")
MOODS = ("calm", "urgent", "scared", "angry", "whisper", "happy", "sad")


def schema() -> dict:
    beat = obj({"kind": S, "who": S, "to": S, "text": S, "mood": S, "object": S})
    option = obj({"label": S, "correct": B, "consequence": arr(beat)})
    choice = obj({"after_beat": I, "prompt": S, "options": arr(option)})
    scene = obj({"id": S, "place": S, "place_description": S, "time": S, "cast": arr(S), "beats": arr(beat), "choices": arr(choice)})
    thing = obj({"id": S, "name": S, "description": S})
    return obj({"title": S, "objects": arr(thing), "scenes": arr(scene)})


@dataclass
class Screenplay:
    title: str
    objects: list[dict]
    scenes: list[dict]


class ScreenplayWriter:
    def __init__(self, model: Model, index: BookIndex):
        self.model, self.index = model, index

    def write(self, c: int, chapter) -> Screenplay:
        ch = self.index.chapters[c]
        cast = [{"id": p.id, "name": p.name, "aliases": p.aliases, "role": p.role} for p in self.index.cast]
        items = {
            "book": self.index.synopsis,
            "chapter": {"title": ch.title, "summary": ch.summary},
            "scenes_in_the_book": [{"paragraphs": f"{s.first}-{s.last}", "place": s.place, "time": s.time, "present": s.present, "summary": s.summary} for s in ch.scenes],
            "cast": cast,
            "text": [f"[{i}] {p}" for i, p in enumerate(chapter.paragraphs)],
        }  # fmt: skip
        ids = {p.id for p in self.index.cast}
        a = self.model.ask(SYSTEM, f"Write the screenplay of chapter {c + 1}", items, schema(), effort="high", check=lambda a: errors(a, ids), repairs=3)
        return Screenplay(a["title"], a["objects"], a["scenes"])


def errors(a: dict, cast_ids: set[str]) -> list[str]:
    """Everything that would break the game, in words the model can act on."""
    out = []
    objects = {o["id"] for o in a["objects"]}
    for s in a["scenes"]:
        where = f"scene {s['id']}"
        out += [f"{where}: {p!r} is not a cast id" for p in s["cast"] if p not in cast_ids]
        here = set(s["cast"])
        out += _beats(s["beats"], here, cast_ids, objects, where)
        if not s["beats"]:
            out.append(f"{where} has no beats")
        for k, ch in enumerate(s["choices"]):
            w = f"{where}, choice {k + 1}"
            if not 0 <= ch["after_beat"] < len(s["beats"]):
                out.append(f"{w}: after_beat {ch['after_beat']} is not a beat of this scene")
            if sum(o["correct"] for o in ch["options"]) != 1 or len(ch["options"]) != 2:
                out.append(f"{w}: needs exactly two options, one correct")
            for o in ch["options"]:
                if not o["correct"] and not o["consequence"]:
                    out.append(f"{w}: the wrong option needs consequence beats")
                out += _beats(o["consequence"], set(here) | set(s["cast"]), cast_ids, objects, f"{w}, option {o['label']!r}")
    if not a["scenes"]:
        out.append("the screenplay has no scenes")
    return out


def _beats(beats: list[dict], here: set[str], cast_ids: set[str], objects: set[str], where: str) -> list[str]:
    out = []
    for i, b in enumerate(beats):
        w = f"{where}, beat {i}"
        kind, who = b["kind"], b["who"]
        if kind not in KINDS:
            out.append(f"{w}: kind {kind!r} must be one of {', '.join(KINDS)}")
            continue
        if kind == "narrate":
            continue
        if who not in cast_ids:
            out.append(f"{w}: {who!r} is not a cast id")
            continue
        if kind == "enter":
            here.add(who)
            continue
        if who not in here:
            out.append(f"{w}: {who} acts but is not in the scene (add them to the scene's cast or an enter beat first)")
        if kind == "exit":
            here.discard(who)
        if b["to"] and b["to"] not in here:
            out.append(f"{w}: {b['to']!r} is not in the scene")
        if b["object"] and b["object"] not in objects:
            out.append(f"{w}: object {b['object']!r} is not in the objects list")
        if kind == "say" and b["mood"] and b["mood"] not in MOODS:
            out.append(f"{w}: mood must be one of {', '.join(MOODS)} or empty")
        if kind in ("say", "do") and not b["text"].strip():
            out.append(f"{w}: empty text")
    return out
