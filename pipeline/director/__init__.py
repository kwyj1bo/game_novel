"""The story director: model decisions about what a chapter shows and how it
is staged. Without a model, the rule pipeline decides alone.

Every answer is cached in the shared library (`director.json`, keyed by a hash
of the request), so building the same chapter again gives the same game and
costs nothing.
"""

import hashlib
import json
import logging
import os
from pathlib import Path

from . import beats as _beats
from . import staging as _staging

log = logging.getLogger(__name__)


class Director:
    def __init__(self, ask, cache: Path | None = None, beats: bool = True):
        self._ask = ask
        # Picking beats did not beat the rules in docs/evaluation.md, so the
        # pipeline turns it on only with NOVEL_DIRECTOR_BEATS=1.
        self.pick_beats = beats
        self.cache_path = cache
        self.cache: dict = json.loads(cache.read_text()) if cache and cache.exists() else {}
        self.dropped = 0  # staging suggestions that failed the engine checks
        self.kept = 0
        self.why: list[str] = []

    def ask(self, system: str, label: str, items: list, schema: dict):
        key = hashlib.sha1(json.dumps([system, label, items, schema], sort_keys=True).encode()).hexdigest()[:20]
        if key not in self.cache:
            try:
                answer = self._ask(system, label, items, schema)
            except Exception as e:  # no credentials, network or API error: rules decide
                log.warning("story director unavailable (%s)", e)
                return None
            if answer is None:
                return None
            self.cache[key] = answer
            self._save()
        return self.cache[key]

    def beats(self, title: str, paragraphs: list[str], scenes, catalog, places: dict, k: int) -> dict[int, str]:
        """Paragraph -> why it matters, for the event chain."""

        def place_title(lid: str) -> str:
            return (catalog["locations"].get(lid) or places.get(lid) or {}).get("title", "somewhere")

        toc = _beats.outline(paragraphs, scenes, place_title)
        valid = {ln.para for sc in scenes for ln in sc.lines}
        return _beats.pick(self.ask, title, toc, k, valid)

    def stage(self, asm, parts) -> dict[int, "_staging.Plan"]:
        """Part index -> checked staging plan, for the parts the model staged.
        `asm` is the story assembler (cast, places, catalog); `parts` its
        (scene, moment) pairs."""
        items, checkers = [{"you_can_use": _staging.actions_menu(asm.cat)}], {}
        prev_loc, prev_people = None, []
        for i, (sc, _) in enumerate(parts):
            if not sc.lines:
                continue
            span = _span(sc)
            around = [ln for ln in asm.a.lines if ln.para in span]
            people = list(dict.fromkeys([*(prev_people if sc.location == prev_loc else []), *asm.present(around)]))
            if asm.hero and asm.hero not in people:
                people.insert(0, asm.hero)
            spots = _staging.spots_of(sc.location, asm.cat, asm.places)
            title = (asm.cat["locations"].get(sc.location) or asm.places.get(sc.location) or {}).get("title", "a room")
            items.append({
                "part": i, "place": title, "context": _context(asm.paragraphs, span), "spots": [_staging.describe(s) for s in spots],
                "people": [{"id": c, "name": asm.name(c), "kind": asm.chars[c].kind} for c in people],
                "lines": [{"line": j, "speaker": ln.speaker if ln.kind == "say" and ln.speaker in people else "narrator", "text": ln.text[:300]} for j, ln in enumerate(sc.lines)],
            })
            speakers = {j: ln.speaker if ln.kind == "say" and ln.speaker in people else None for j, ln in enumerate(sc.lines)}
            checkers[i] = _staging.Checker(asm.cat, {c: asm.chars[c].kind for c in people}, spots, speakers)
            prev_loc, prev_people = sc.location, people
        if len(items) == 1:
            return {}
        answer = self.ask(_staging.SYSTEM, f"Stage the parts of “{asm.title}”", items, _staging.schema()) or {"parts": []}
        plans = {}
        for part in answer["parts"]:
            if part.get("part") in checkers:
                plan = checkers[part["part"]].plan(part)
                self.dropped += plan.dropped
                self.why += plan.why
                self.kept += plan.kept
                if plan.cast:
                    plans[part["part"]] = plan
        return plans

    def _save(self) -> None:
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache, indent=1, ensure_ascii=False))


CONTEXT_CHARS = 4000
PARAGRAPH_CHARS = 500


def _span(sc) -> list[int]:
    """The book paragraphs a scene part covers, plus the two before it."""
    paras = sorted({ln.para for ln in sc.lines})
    return list(range(max(0, paras[0] - 2), paras[-1] + 1))


def _context(paragraphs: list[str], span: list[int]) -> str:
    """The book's own text around a part: each paragraph cut to 500
    characters, 4000 in all, so the model sees who is really there."""
    out = ""
    for p in span:
        text = " ".join(paragraphs[p].split())
        text = text if len(text) <= PARAGRAPH_CHARS else text[:PARAGRAPH_CHARS].rsplit(" ", 1)[0] + "…"
        if len(out) + len(text) > CONTEXT_CHARS:
            break
        out = f"{out}\n{text}".strip()
    return out


def default_director(library: Path) -> Director | None:
    """A director using the asset model, or None when AI is off."""
    if os.environ.get("NOVEL_ASSET_AI", "1") == "0" or os.environ.get("NOVEL_DIRECTOR", "1") == "0":
        return None
    from ..assetgen import asker, default_client

    try:
        effort = os.environ.get("NOVEL_DIRECTOR_EFFORT", "high")
        return Director(asker(default_client(), effort), library / "director.json", beats=os.environ.get("NOVEL_DIRECTOR_BEATS") == "1")
    except Exception as e:  # SDK missing
        log.warning("story director unavailable (%s)", e)
        return None
