"""What the AI asset steps read: the book text about a character's looks, and
about the place a scene happens in.

Three modes, chosen with NOVEL_RETRIEVAL:

- keyword: sentences that name the character and use a look word (the
  original rule), and the first lines of a scene.
- hybrid: BM25 + embedding search over the sentences near the character, or
  inside the scene.
- tree: a model navigates the PageIndex-style tree to the sections that
  describe them, then hybrid search ranks the sentences inside.

Every mode returns the same budget of text, so they compare fairly.
"""

import logging
import os
import re

from .search import SearchIndex
from .tree import BookTree

log = logging.getLogger(__name__)
MODES = ("keyword", "hybrid", "tree")
MAX_DESCRIPTIONS = 6
PLACE_CHARS = 900
LOOK_QUERY = "{name}: appearance, face, hair, eyes, beard, moustache, glasses, scar, tall, short, fat, thin, old, young, wearing robes, cloak, coat"
PLACE_QUERY = "the place: room, hall, walls, floor, ceiling, windows, door, light, fire, candles, trees, sky, street, furniture, dark, inside"
LOOK_QUESTION = "Where does the book describe what {name} looks like (face, hair, height, clothes)?"
PLACE_QUESTION = "Where does the book describe the place of this scene (its walls, light, furniture)? The scene starts: \"{start}\""


# Best per task in docs/evaluation.md: the tree for looks (a character is
# described where they are introduced), hybrid search for places (the scene
# itself describes its place, and the tree tends to wander to other scenes).
DEFAULTS = {"looks": "tree", "places": "hybrid"}


def mode(task: str = "looks") -> str:
    m = os.environ.get("NOVEL_RETRIEVAL", DEFAULTS[task])
    return m if m in MODES else DEFAULTS[task]


class Retriever:
    """One book's retrieval, shared by the looks and places steps."""

    def __init__(self, chapters, analyses, how: str | None = None, ask=None, catalog=None, encoder="default"):
        self.chapters, self.analyses = chapters, analyses
        self.how = how or mode()
        self.ask = ask
        self.catalog = catalog
        self.index = SearchIndex.of_book(chapters, encoder) if self.how != "keyword" else None
        self._tree: BookTree | None = None

    @property
    def tree(self) -> BookTree:
        if self._tree is None:
            if self.catalog is None:
                from ..__main__ import load_catalog

                self.catalog = load_catalog()
            self._tree = BookTree.build(self.chapters, self.analyses, self.catalog)
        return self._tree

    # ---- looks ------------------------------------------------------------

    def looks(self, people) -> dict[str, list[str]]:
        """Character id -> sentences about how they look."""
        if self.how == "keyword":
            from ..assetgen import descriptions

            return {c.id: descriptions(self.chapters, c) for c in people}
        near = {c.id: self._near(c) for c in people}
        if self.how == "tree" and self.ask:
            qs = [{"id": c.id, "question": LOOK_QUESTION.format(name=c.name)} for c in people]
            for cid, leaves in self._navigate(qs).items():
                if leaves:
                    near[cid] = self.index.in_paragraphs((n.chapter, p) for n in leaves for p in n.paras)
        return {c.id: self._top(LOOK_QUERY.format(name=c.name), near[c.id], MAX_DESCRIPTIONS) for c in people}

    def _near(self, c) -> list[int]:
        """Sentences in paragraphs naming the character, the paragraph after
        each (where "he" or "she" goes on), and the few before their first
        mention (people are often described before they are named)."""
        pattern = name_pattern(c)
        keys: list[tuple[int, int]] = []
        for ci, ch in enumerate(self.chapters):
            hits = [p for p, text in enumerate(ch.paragraphs) if pattern.search(text)]
            if hits and not keys:
                keys += [(ci, p) for p in range(max(0, hits[0] - 3), hits[0])]
            for p in hits:
                keys += [(ci, p), (ci, p + 1)]
        return self.index.in_paragraphs(keys)

    # ---- places -----------------------------------------------------------

    def places(self, scenes: list[dict]) -> dict[str, str]:
        """Scene key -> text about where it happens. A scene is
        {"key", "chapter" (index), "paras", "start" (its first line)}."""
        if self.how == "keyword":
            return {s["key"]: s["start"][:PLACE_CHARS] for s in scenes}
        within = {s["key"]: self.index.in_paragraphs((s["chapter"], p) for p in s["paras"]) for s in scenes}
        if self.how == "tree" and self.ask:
            qs = [{"id": s["key"], "question": PLACE_QUESTION.format(start=s["start"][:160])} for s in scenes]
            for key, leaves in self._navigate(qs).items():
                if leaves:
                    within[key] = self.index.in_paragraphs((n.chapter, p) for n in leaves for p in n.paras)
        return {s["key"]: self._budget(self._top(PLACE_QUERY, within[s["key"]], 12), PLACE_CHARS) for s in scenes}

    def library_hints(self, library: dict, texts: list[str], k: int = 5) -> list[str]:
        """Ids of the library places most like any of these scenes."""
        ids = list(library)
        if not ids or self.how == "keyword":
            return ids
        from .search import Passage

        index = SearchIndex([Passage(-1, i, f"{library[p]['title']} ({library[p]['preset']['type']})") for i, p in enumerate(ids)], self.index.encoder)
        return [ids[i] for i in dict.fromkeys(i for t in texts for i in index.search(t, k))]

    # ---- helpers ----------------------------------------------------------

    def _navigate(self, questions: list[dict]) -> dict:
        """Tree navigation; on any failure the hybrid candidates stay."""
        try:
            return self.tree.navigate(self.ask, questions)
        except Exception as e:  # model error or an answer in the wrong shape
            log.warning("tree navigation failed (%s); using hybrid search", e)
            return {}

    def _top(self, query: str, within: list[int], k: int) -> list[str]:
        best = self.index.search(query, k, within)
        return [self.index.passages[i].text for i in sorted(best)]  # reading order

    @staticmethod
    def _budget(sentences: list[str], limit: int) -> str:
        out = ""
        for s in sentences:
            if len(out) + len(s) + 1 > limit:
                break
            out = f"{out} {s}".strip()
        return out


def name_pattern(c) -> re.Pattern:
    names = {w for w in [c.name, *c.name.split(), *getattr(c, "aliases", ())] if len(w) > 2 and w[:1].isupper()}
    return re.compile(r"\b(" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")\b")
