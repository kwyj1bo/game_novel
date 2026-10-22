"""End-to-end checks of the novel pipeline on original fixture chapters."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline.__main__ import ROOT, build_chapter, load_catalog
from pipeline.text import load_chapters

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


def build(name, catalog):
    ch = load_chapters(FIX / name)[0]
    return build_chapter(ch, catalog, "Fixture")


@pytest.fixture(scope="module")
def halloween(catalog):
    return build("halloween.txt", catalog)


@pytest.fixture(scope="module")
def lighthouse(catalog):
    return build("lighthouse.txt", catalog)


def test_chapter_heading_and_title():
    ch = load_chapters(FIX / "halloween.txt")[0]
    assert ch.heading == "CHAPTER TEN"
    assert ch.title == "The Troll"


def test_characters_kinds_and_genders(halloween, lighthouse):
    a = halloween[1]
    got = {c.id: (c.kind, c.gender) for c in a.characters.values()}
    assert got == {
        "harry": ("human", "m"),
        "ron": ("human", "m"),
        "hermione": ("human", "f"),
        "mcgonagall": ("human", "f"),
        "troll": ("troll", "n"),
    }
    assert a.protagonist == "harry"
    b = lighthouse[1]
    assert {c.id: (c.kind, c.gender) for c in b.characters.values()} == {
        "mara": ("human", "f"),
        "tobin": ("human", "m"),
        "dog": ("dog3", "n"),
    }


def test_every_line_of_dialogue_has_the_right_speaker(halloween, lighthouse):
    said = [ln.speaker for ln in halloween[1].lines if ln.kind == "say"]
    assert said == [
        "harry", "ron", "ron", "ron", "harry", "ron", "harry", "harry", "hermione", "ron",
        "harry", "harry", "ron", "hermione", "harry", "mcgonagall", "mcgonagall", "hermione", "hermione",
    ]
    said = [ln.speaker for ln in lighthouse[1].lines if ln.kind == "say"]
    assert said == ["mara", "mara", "tobin", "tobin", "mara", "tobin", "mara", "tobin", "mara"]


def test_speech_tags_are_not_narration(halloween):
    narr = [ln.text for ln in halloween[1].lines if ln.kind == "narrate"]
    assert "Ron asked." not in narr
    assert not any(t.startswith('"') for t in narr)


def test_choices_are_the_heros_action_and_its_opposite(halloween, lighthouse):
    assert [(m.correct, m.opposite) for m in halloween[3]] == [
        ("Unlock the door", "Leave the door locked"),
        ("Run at the troll", "Keep away from the troll"),
    ]
    assert [(m.correct, m.opposite) for m in lighthouse[3]] == [("Pick up the lantern", "Leave the lantern where it is")]


def test_scenes_follow_locations(halloween):
    assert [s.location for s in halloween[2]] == ["castle_corridor", "girls_bathroom"]


def test_wrong_branches_end_the_run(halloween):
    story = halloween[0]
    for scene in story["scenes"].values():
        if "choice" not in scene:
            continue
        wrong = next(o for o in scene["choice"]["options"] if not o["correct"])
        assert story["scenes"][wrong["goto"]]["ending"]["kind"] in ("death", "failure")


def test_people_only_talked_about_are_not_on_stage(halloween):
    first = halloween[0]["scenes"]["scene_1"]
    assert "hermione" not in first["cast"]
    assert "troll" not in first["cast"]
    assert any(b.get("spawn") == "troll" for b in first["beats"])


def test_build_is_deterministic(catalog, halloween):
    again = build("halloween.txt", catalog)
    assert json.dumps(again[0], sort_keys=True) == json.dumps(halloween[0], sort_keys=True)


@pytest.mark.skipif(shutil.which("npx") is None, reason="needs Node for the engine validator")
@pytest.mark.parametrize("name", ["halloween.txt", "lighthouse.txt"])
def test_engine_validator_accepts_generated_story(catalog, tmp_path, name):
    story = build(name, catalog)[0]
    path = tmp_path / "story.json"
    path.write_text(json.dumps(story))
    r = subprocess.run(["npx", "vite-node", "scripts/validate-story.ts", str(path)], cwd=ROOT / "web", capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
