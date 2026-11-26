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

log = logging.getLogger(__name__)


class Director:
    def __init__(self, ask, cache: Path | None = None):
        self._ask = ask
        self.cache_path = cache
        self.cache: dict = json.loads(cache.read_text()) if cache and cache.exists() else {}

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
