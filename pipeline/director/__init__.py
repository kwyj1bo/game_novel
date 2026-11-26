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
    def __init__(self, ask, cache: Path | None = None):
        self._ask = ask
        self.cache_path = cache
        self.cache: dict = json.loads(cache.read_text()) if cache and cache.exists() else {}
        self.dropped = 0  # staging suggestions that failed the engine checks
        self.kept = 0

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
        items, checkers = [{"actions": _staging.actions_menu(asm.cat)}], {}
        prev_loc, prev_people = None, []
        for i, (sc, _) in enumerate(parts):
            if not sc.lines:
                continue
            people = list(dict.fromkeys([*(prev_people if sc.location == prev_loc else []), *asm.present(sc.lines)]))
            if asm.hero and asm.hero not in people:
                people.insert(0, asm.hero)
            spots = _staging.spots_of(sc.location, asm.cat, asm.places)
            title = (asm.cat["locations"].get(sc.location) or asm.places.get(sc.location) or {}).get("title", "a room")
            items.append({
                "part": i, "place": title, "spots": [_staging.describe(s) for s in spots],
                "people": [{"id": c, "name": asm.name(c), "kind": asm.chars[c].kind} for c in people],
                "lines": [{"line": j, "who": asm.name(ln.speaker) if ln.kind == "say" else "narrator", "text": ln.text[:300]} for j, ln in enumerate(sc.lines)],
            })
            checkers[i] = _staging.Checker(asm.cat, {c: asm.chars[c].kind for c in people}, spots, len(sc.lines))
            prev_loc, prev_people = sc.location, people
        if len(items) == 1:
            return {}
        answer = self.ask(_staging.SYSTEM, f"Stage the parts of “{asm.title}”", items, _staging.schema()) or {"parts": []}
        plans = {}
        for part in answer["parts"]:
            if part.get("part") in checkers:
                plan = checkers[part["part"]].plan(part)
                self.dropped += plan.dropped
                self.kept += plan.kept
                if plan.cast:
                    plans[part["part"]] = plan
        return plans

    def _save(self) -> None:
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache, indent=1, ensure_ascii=False))


def default_director(library: Path) -> Director | None:
    """A director using the asset model, or None when AI is off."""
    if os.environ.get("NOVEL_ASSET_AI", "1") == "0" or os.environ.get("NOVEL_DIRECTOR", "1") == "0":
        return None
    from ..assetgen import asker, default_client

    try:
        return Director(asker(default_client()), library / "director.json")
    except Exception as e:  # SDK missing
        log.warning("story director unavailable (%s)", e)
        return None
