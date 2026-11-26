"""The book index: what the agents read instead of the whole novel.

A PageIndex-style tree written by the model: the book's synopsis, each
chapter's summary, and each chapter's scenes (paragraph range, place, time,
who is present, summary). A merged cast list gives every person one id.
Two ways in:

- `navigate`: the model reads the tree and picks the scenes that answer a
  question (reasoning over structure, PageIndex's idea).
- `evidence`: navigate, then rank the sentences inside those scenes with
  hybrid search (BM25 + embeddings), returning quotes with their location.
"""

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .llm import S, I, Model, arr, obj

SUMMARY_SYSTEM = (
    "You index a chapter of a novel for the people adapting it into a game. You get its paragraphs, numbered "
    "from 0. Write a short summary of the chapter. Split it into scenes: a new scene starts when the place or "
    "the time changes. Every paragraph belongs to exactly one scene, in order. For each scene give the first and "
    "last paragraph number, the place, the time, the people physically present (not people only mentioned) and a "
    "two-sentence summary of what happens. List the people of the chapter with the other names the text uses "
    "for them, and anything it says about how they look."
)
CAST_SYSTEM = (
    "You merge the people found in each chapter of a novel into one cast. The same person may appear under "
    "several names (a first name, a surname, a title, a nickname): give them one entry. Give each person a short "
    "lowercase id (letters and underscores), their usual name, every other name, their role in the story, and "
    "everything the book says about how they look. Also write a synopsis of the whole book."
)
NAVIGATE_SYSTEM = (
    "You find passages in a novel using its table of contents: the synopsis, each chapter's summary and its "
    "scenes ([c3.s2] place, who is present: summary). For each question, choose the scene ids most likely to hold "
    "the answer, best first. Prefer the scene where a person, place or object is first introduced or described."
)


@dataclass
class Scene:
    id: str
    first: int
    last: int
    place: str
    time: str
    present: list[str]
    summary: str


@dataclass
class Chapter:
    title: str
    summary: str
    scenes: list[Scene]
    people: list[dict]


@dataclass
class Person:
    id: str
    name: str
    aliases: list[str]
    role: str
    looks: str


@dataclass
class BookIndex:
    synopsis: str
    chapters: list[Chapter]
    cast: list[Person] = field(default_factory=list)

    def scene(self, sid: str) -> tuple[int, Scene] | None:
        m = re.fullmatch(r"c(\d+)\.s(\d+)", sid)
        if not m:
            return None
        c, s = int(m[1]) - 1, int(m[2]) - 1
        if 0 <= c < len(self.chapters) and 0 <= s < len(self.chapters[c].scenes):
            return c, self.chapters[c].scenes[s]
        return None

    def outline(self) -> str:
        lines = [f"Synopsis: {self.synopsis}"]
        for c, ch in enumerate(self.chapters):
            lines.append(f"[c{c + 1}] {ch.title}: {ch.summary}")
            lines += [f"  [{sc.id}] {sc.place}; {', '.join(sc.present) or 'nobody named'}: {sc.summary}" for sc in ch.scenes]
        return "\n".join(lines)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=1, ensure_ascii=False))

    @classmethod
    def load(cls, path: Path) -> "BookIndex":
        d = json.loads(path.read_text())
        chapters = [Chapter(c["title"], c["summary"], [Scene(**s) for s in c["scenes"]], c["people"]) for c in d["chapters"]]
        return cls(d["synopsis"], chapters, [Person(**p) for p in d["cast"]])


class Indexer:
    """Builds a BookIndex with one request per chapter and one for the cast."""

    def __init__(self, model: Model):
        self.model = model

    def build(self, chapters) -> BookIndex:
        indexed = [self.chapter(c, ch) for c, ch in enumerate(chapters)]
        book = self.cast(indexed)
        return BookIndex(book["synopsis"], indexed, [Person(**p) for p in book["cast"]])

    def chapter(self, c: int, ch) -> Chapter:
        n = len(ch.paragraphs)
        scene = obj({"first": I, "last": I, "place": S, "time": S, "present": arr(S), "summary": S})
        person = obj({"name": S, "aliases": arr(S), "looks": S})
        schema = obj({"summary": S, "scenes": arr(scene), "people": arr(person)})
        items = {"chapter": ch.title, "paragraphs": [f"[{i}] {p}" for i, p in enumerate(ch.paragraphs)]}
        a = self.model.ask(SUMMARY_SYSTEM, f"Index chapter {c + 1}", items, schema, effort="medium", check=lambda a: scene_errors(a["scenes"], n))
        scenes = [Scene(f"c{c + 1}.s{k + 1}", s["first"], s["last"], s["place"], s["time"], s["present"], s["summary"]) for k, s in enumerate(a["scenes"])]
        return Chapter(ch.title, a["summary"], scenes, a["people"])

    def cast(self, chapters: list[Chapter]) -> dict:
        person = obj({"id": S, "name": S, "aliases": arr(S), "role": S, "looks": S})
        schema = obj({"synopsis": S, "cast": arr(person)})
        items = [{"chapter": f"c{c + 1} {ch.title}", "summary": ch.summary, "people": ch.people} for c, ch in enumerate(chapters)]
        return self.model.ask(CAST_SYSTEM, "Merge the cast", items, schema, effort="medium", check=cast_errors)


def navigate(model: Model, index: BookIndex, questions: list[dict], k: int = 3) -> dict[str, list[str]]:
    """Question id -> scene ids the model chose from the table of contents."""
    schema = obj({"picks": arr(obj({"id": S, "scenes": arr(S)}))})
    items = {"table_of_contents": index.outline(), "questions": questions}
    known = {q["id"] for q in questions}

    def errors(a):
        bad = [s for p in a["picks"] for s in p["scenes"] if not index.scene(s)]
        return [f"no scene {s}" for s in bad] + [f"no question {p['id']}" for p in a["picks"] if p["id"] not in known]

    a = model.ask(NAVIGATE_SYSTEM, f"Questions (at most {k} scene ids each)", items, schema, effort="low", check=errors)
    return {p["id"]: p["scenes"][:k] for p in a["picks"]}


def scene_errors(scenes: list[dict], n: int) -> list[str]:
    """Scenes must cover paragraphs 0 to n-1, in order, without gaps or overlaps."""
    errors, expect = [], 0
    for s in scenes:
        if s["first"] != expect:
            errors.append(f"a scene starts at paragraph {s['first']}, but paragraph {expect} is the next one not yet in a scene")
        if s["last"] < s["first"]:
            errors.append(f"the scene {s['first']}-{s['last']} ends before it starts")
        expect = s["last"] + 1
    if expect != n:
        errors.append(f"the last scene ends at paragraph {expect - 1}, but the chapter's last paragraph is {n - 1}")
    return errors


def cast_errors(a: dict) -> list[str]:
    ids = [p["id"] for p in a["cast"]]
    errors = [f"id {i!r} is used twice" for i in set(ids) if ids.count(i) > 1]
    return errors + [f"id {i!r} must be lowercase letters and underscores" for i in ids if not re.fullmatch(r"[a-z][a-z_]*", i)]
