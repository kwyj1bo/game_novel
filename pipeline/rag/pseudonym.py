"""Replace a book's names with made-up ones, for evaluation.

A model has read famous novels. Asked what "Harry" looks like, it answers
from memory, whatever passages it is given, and the test measures nothing.
With every character and world name replaced ("Harry" -> "Tobrin"), the model
can only use the text that retrieval found.
"""

import re
from dataclasses import replace

from ..analyze import Character
from ..text import Chapter

HONORIFICS = {"mr", "mrs", "ms", "miss", "madam", "professor", "uncle", "aunt", "sir", "lord", "lady", "dr", "the", "of"}
ONSETS = ["b", "br", "c", "d", "dr", "f", "g", "gr", "h", "k", "l", "m", "n", "p", "r", "s", "t", "th", "v", "w"]
VOWELS = ["a", "e", "i", "o", "u", "ae", "io"]
CODAS = ["n", "r", "l", "s", "th", "m", "d", "x", "nd", "rk"]


class Pseudonyms:
    """A fixed mapping from real name words to invented ones."""

    def __init__(self, words: set[str]):
        self.map: dict[str, str] = {}
        used: set[str] = set()
        for i, w in enumerate(sorted(words)):
            fake = _invent(i, used)
            used.add(fake)
            self.map[w] = fake
            self.map[w.upper()] = fake.upper()  # chapter titles in capitals
        alt = "|".join(re.escape(w) for w in sorted(self.map, key=len, reverse=True))
        self._re = re.compile(rf"\b({alt})\b") if alt else None

    @classmethod
    def for_catalog(cls, catalog, extra: set[str] = frozenset()) -> "Pseudonyms":
        words = set(extra)
        for cid, c in catalog["characters"].items():
            for name in c["names"]:
                words |= {w for w in re.findall(r"[A-Z][A-Za-z'-]+", name) if w.lower() not in HONORIFICS and len(w) > 2}
        return cls(words)

    def text(self, s: str) -> str:
        return self._re.sub(lambda m: self.map[m.group(1)], s) if self._re else s

    def chapters(self, chapters: list[Chapter]) -> list[Chapter]:
        return [replace(ch, title=self.text(ch.title), paragraphs=[self.text(p) for p in ch.paragraphs]) for ch in chapters]

    def character(self, cid: str, names: list[str]) -> Character:
        """An evaluation character known by the fake forms of its names."""
        fakes = [self.text(n) for n in names]
        full = max(fakes, key=lambda n: len(n.split()))
        return Character(id=cid, name=full, aliases=set(fakes))


def _invent(i: int, used: set[str]) -> str:
    """Two invented syllables ("Brelith", "Tovarn"), never reused."""
    k = i
    while True:
        name = (ONSETS[k % 20] + VOWELS[k // 20 % 7] + CODAS[k // 140 % 10] + VOWELS[(k * 3 + 1) % 7] + CODAS[(k * 7 + 3) % 10]).capitalize()
        if name not in used:
            return name
        k += 1409
