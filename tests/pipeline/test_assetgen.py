"""AI looks for characters without an asset, with a fake model client."""

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import assetgen
from pipeline.__main__ import ROOT, build_chapter, load_catalog
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
    assert assetgen.add_looks(chapters, analyses, tmp_path / "lib", client) >= 2
    asked = json.loads(client.calls[0]["messages"][0]["content"].split("\n", 1)[1])
    rourke = next(p for p in asked if p["id"] == "rourke")
    assert any("grey beard" in s for s in rourke["book_says"])
    story = build_chapter(chapters[0], catalog, "Fixture", analysis=analyses[0])[0]
    assert story["actors"]["rourke"]["beard"] == "long" and story["actors"]["rourke"]["name"] == "Rourke"


def test_looks_are_kept_in_the_shared_library(voyage, tmp_path):
    _, chapters, analyses = voyage
    library = tmp_path / "lib"
    assetgen.add_looks(chapters, analyses, library, FakeClient())
    again = FakeClient()
    assetgen.add_looks(chapters, analyses, library, again)
    assert again.calls == [] and "elena" in json.loads((library / "looks.json").read_text())


def test_no_model_keeps_generated_looks(voyage, tmp_path):
    _, chapters, analyses = voyage

    class Broken:
        beta = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: (_ for _ in ()).throw(RuntimeError("no credentials"))))

    assert assetgen.add_looks(chapters, analyses, tmp_path / "lib", Broken()) == 0
    assert all(c.look is None for a in analyses for c in a.characters.values())


def test_invalid_looks_are_dropped():
    assert assetgen.valid({**LOOK, "robe": "blue"}) is None
    assert assetgen.valid({**LOOK, "hairStyle": "mohawk"}) is None
    assert assetgen.valid({**LOOK, "height": 9})["height"] == 3.2


# ---- places

WINDMILL = """Chapter One
The Mill

The old windmill creaked in the wind. Flour dust hung in the air, and sacks of grain leaned against the wooden walls.

Tom climbed the ladder to the top floor. "Is anyone up here?" he called.

A girl stepped out from behind the millstone. "Only me," said Anna. "Grandfather is asleep."

Tom picked up the lantern and held it high. The wind howled outside.

"We have to fix the brake before the storm," Anna said.

Tom grabbed the rope and pulled with all his strength.
"""


class FakePlaces:
    """Answers like the model: one windmill for every scene asked about, or
    `reuse` when that library place was offered."""

    def __init__(self, reuse=""):
        self.calls = []
        self.reuse = reuse
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        items = json.loads(kw["messages"][0]["content"].split("\n", 1)[1])
        self.offered = items[0]["library"]
        scenes = items[1:]
        places = [{"key": s["key"], "reuse": self.reuse, "title": "The Old Windmill", "type": "cellar", "time": "dusk", "wall": "#8a6a44", "floor": "wood",
                   "props": [{"kind": "barrel", "count": 3}, {"kind": "crate", "count": 9}, {"kind": "spaceship", "count": 1}]} for s in scenes]
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps({"places": places}))])


@pytest.fixture
def mill(monkeypatch, tmp_path):
    monkeypatch.setenv("NOVEL_ASSET_AI", "1")
    (tmp_path / "mill.txt").write_text(WINDMILL)
    catalog = load_catalog()
    chapters = load_chapters(tmp_path / "mill.txt")
    return catalog, chapters, [analyze(ch.paragraphs, catalog) for ch in chapters]


def test_unplaced_scenes_get_an_ai_made_place(mill, tmp_path):
    catalog, chapters, analyses = mill
    places = assetgen.add_places(chapters, analyses, catalog, tmp_path / "lib", FakePlaces())
    story = build_chapter(chapters[0], catalog, "Fixture", analysis=analyses[0], places=places)[0]
    assert story["sceneries"] == {"gen_the_old_windmill": {"title": "The Old Windmill", "preset": {
        "type": "cellar", "time": "dusk", "props": [{"kind": "barrel", "count": 3}, {"kind": "crate", "count": 6}], "wall": "#8a6a44", "floor": "wood"}}}
    assert {s["location"] for s in story["scenes"].values()} == {"gen_the_old_windmill"}
    path = tmp_path / "story.json"
    path.write_text(json.dumps(story))
    if shutil.which("npx"):
        r = subprocess.run(["npx", "vite-node", "scripts/validate-story.ts", str(path)], cwd=ROOT / "web", capture_output=True, text=True)
        assert r.returncode == 0, r.stdout + r.stderr


def test_places_are_cached_and_skipped_without_a_model(mill, tmp_path):
    catalog, chapters, analyses = mill
    library = tmp_path / "lib"
    assetgen.add_places(chapters, analyses, catalog, library, FakePlaces())
    again = FakePlaces()
    assert assetgen.add_places(chapters, analyses, catalog, library, again) and again.calls == []
    story = build_chapter(chapters[0], catalog, "Fixture", analysis=analyses[0])[0]
    assert "sceneries" not in story and {s["location"] for s in story["scenes"].values()} == {catalog["defaultScenery"]}


# ---- Claude Code instead of an API key

FAKE_CLAUDE = """#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
assert "-p" in args and args[args.index("--tools") + 1] == ""
schema = json.loads(args[args.index("--json-schema") + 1])
people = json.loads(sys.stdin.read().split("\\n", 1)[1])
look = json.loads(%r)
print(json.dumps({"type": "result", "is_error": False, "result": "", "structured_output": {"looks": [{"id": p["id"], **look} for p in people]}}))
""" % json.dumps(LOOK)


def test_looks_can_come_from_claude_code(voyage, tmp_path, monkeypatch):
    _, chapters, analyses = voyage
    fake = tmp_path / "claude"
    fake.write_text(FAKE_CLAUDE)
    fake.chmod(0o755)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("NOVEL_CLAUDE_BIN", str(fake))
    assert isinstance(assetgen.default_client(), assetgen.ClaudeCode)
    assert assetgen.add_looks(chapters, analyses, tmp_path / "lib") >= 2
    assert next(c for a in analyses for c in a.characters.values() if c.id == "rourke").look["beard"] == "long"


def test_a_signed_out_claude_code_falls_back(voyage, tmp_path, monkeypatch):
    _, chapters, analyses = voyage
    fake = tmp_path / "claude"
    fake.write_text('#!/bin/sh\necho \'{"is_error": true, "result": "Failed to authenticate"}\'\n')
    fake.chmod(0o755)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("NOVEL_CLAUDE_BIN", str(fake))
    assert assetgen.add_looks(chapters, analyses, tmp_path / "lib") == 0


def test_a_capitalised_common_noun_is_not_a_character(mill):
    # "Flour dust hung in the air" starts a sentence with a common noun.
    _, _, analyses = mill
    assert "flour" not in analyses[0].characters
    assert {"tom", "anna"} <= set(analyses[0].characters)


def test_a_new_book_reuses_library_places(mill, tmp_path):
    catalog, chapters, analyses = mill
    library = tmp_path / "lib"
    assetgen.add_places(chapters, analyses, catalog, library, FakePlaces())
    # Another book whose scene the library already has a place for.
    other = load_chapters(FIX / "voyage.txt")[:1]
    other[0].paragraphs = ["Grain sacks were stacked to the rafters of the mill.", *chapters[0].paragraphs[1:]]
    other_an = [analyze(ch.paragraphs, catalog) for ch in other]
    model = FakePlaces(reuse="gen_the_old_windmill")
    places = assetgen.add_places(other, other_an, catalog, library, model)
    assert model.offered == [{"id": "gen_the_old_windmill", "title": "The Old Windmill", "type": "cellar"}]
    store = json.loads((library / "places.json").read_text())
    assert list(store["places"]) == ["gen_the_old_windmill"] and len(store["scenes"]) == 2
    assert {p["id"] for p in places.values()} == {"gen_the_old_windmill"}
