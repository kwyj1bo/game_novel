"""AI looks for characters without an asset, with a fake model client."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import assetgen
from pipeline.__main__ import build_chapter, load_catalog
from pipeline.analyze import analyze
from pipeline.text import load_chapters

FIX = Path(__file__).parent / "fixtures"
LOOK = {"height": 1.9, "robe": "#1a2b3c", "skin": "#c98e66", "hair": "#6a6a6a", "hairStyle": "short", "eyes": "#223344",
        "glasses": "none", "beard": "long", "outfit": "adult", "hat": "none", "scar": True, "voice": 0.85}


class FakeClient:
    """Answers like the model: one look per character asked about."""

    def __init__(self):
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        people = json.loads(kw["messages"][0]["content"].split("\n", 1)[1])
        looks = [{"id": p["id"], **LOOK} for p in people]
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps({"looks": looks}))])


@pytest.fixture
def voyage(monkeypatch):
    monkeypatch.setenv("NOVEL_ASSET_AI", "1")
    catalog = load_catalog()
    chapters = load_chapters(FIX / "voyage.txt")
    return catalog, chapters, [analyze(ch.paragraphs, catalog) for ch in chapters]


def test_missing_characters_get_ai_looks_and_the_book_text(voyage, tmp_path):
    catalog, chapters, analyses = voyage
    client = FakeClient()
    assert assetgen.add_looks(chapters, analyses, tmp_path / "looks.json", client) >= 2
    asked = json.loads(client.calls[0]["messages"][0]["content"].split("\n", 1)[1])
    rourke = next(p for p in asked if p["id"] == "rourke")
    assert any("grey beard" in s for s in rourke["book_says"])
    story = build_chapter(chapters[0], catalog, "Fixture", analysis=analyses[0])[0]
    assert story["actors"]["rourke"]["beard"] == "long" and story["actors"]["rourke"]["name"] == "Rourke"


def test_looks_are_cached_per_book(voyage, tmp_path):
    _, chapters, analyses = voyage
    cache = tmp_path / "looks.json"
    assetgen.add_looks(chapters, analyses, cache, FakeClient())
    again = FakeClient()
    assetgen.add_looks(chapters, analyses, cache, again)
    assert again.calls == [] and "elena" in json.loads(cache.read_text())


def test_no_model_keeps_generated_looks(voyage, tmp_path):
    _, chapters, analyses = voyage

    class Broken:
        beta = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: (_ for _ in ()).throw(RuntimeError("no credentials"))))

    assert assetgen.add_looks(chapters, analyses, tmp_path / "looks.json", Broken()) == 0
    assert all(c.look is None for a in analyses for c in a.characters.values())


def test_invalid_looks_are_dropped():
    assert assetgen.valid({**LOOK, "robe": "blue"}) is None
    assert assetgen.valid({**LOOK, "hairStyle": "mohawk"}) is None
    assert assetgen.valid({**LOOK, "height": 9})["height"] == 3.2
