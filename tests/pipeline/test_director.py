"""The story director with a fake model: picked beats, caching and fallbacks."""

from pathlib import Path

import pytest

from pipeline.__main__ import build_chapter, load_catalog
from pipeline.analyze import analyze
from pipeline.director import Director
from pipeline.text import load_chapters

FIX = Path(__file__).parent / "fixtures"


class FakeModel:
    """Picks the paragraphs it is told to, and counts requests."""

    def __init__(self, paragraphs: list[int]):
        self.paragraphs = paragraphs
        self.calls = []

    def __call__(self, system, label, items, schema):
        self.calls.append(items)
        if "beats" in schema["properties"]:
            return {"beats": [{"paragraph": p, "why": f"beat {p}"} for p in self.paragraphs]}
        return {"parts": []}


@pytest.fixture(scope="module")
def halloween():
    catalog = load_catalog()
    ch = load_chapters(FIX / "halloween.txt")[0]
    return catalog, ch


def test_the_chain_keeps_what_the_director_picked(halloween, tmp_path):
    catalog, ch = halloween
    a = analyze(ch.paragraphs, catalog)
    wanted = sorted({ln.para for ln in a.lines})[2:7]
    model = FakeModel(wanted + [10_000])  # a paragraph that does not exist is dropped
    _, _, _, moments, chain = build_chapter(ch, catalog, "Fixture", analysis=a, director=Director(model, tmp_path / "d.json"))
    kept = {n.para for n in chain}
    assert set(wanted) <= kept
    choice_paras = {a.lines[m.line].para for m in moments}
    assert choice_paras <= kept  # choices stay whatever the director says
    assert any(r.startswith("director:") for n in chain for r in n.reasons)
    toc = model.calls[0][0]["table_of_contents"]
    assert toc.startswith("[scene 1]") and f"({wanted[0]})" in toc


def test_answers_are_cached_so_rebuilds_are_free(halloween, tmp_path):
    catalog, ch = halloween
    a = analyze(ch.paragraphs, catalog)
    para = sorted({ln.para for ln in a.lines})[3]
    first = FakeModel([para])
    build_chapter(ch, catalog, "Fixture", analysis=a, director=Director(first, tmp_path / "d.json"))
    again = FakeModel([])
    chain = build_chapter(ch, catalog, "Fixture", analysis=analyze(ch.paragraphs, catalog), director=Director(again, tmp_path / "d.json"))[4]
    assert again.calls == [] and para in {n.para for n in chain}


def test_without_an_answer_the_rules_decide(halloween, tmp_path):
    catalog, ch = halloween

    def broken(*_):
        raise RuntimeError("no credentials")

    rules = build_chapter(ch, catalog, "Fixture")[4]
    fallback = build_chapter(ch, catalog, "Fixture", director=Director(broken, tmp_path / "d.json"))[4]
    assert [n.para for n in fallback] == [n.para for n in rules]


class StagingModel:
    """Stages the first part of the Halloween chapter, with some mistakes."""

    def __call__(self, system, label, items, schema):
        if "beats" in schema["properties"]:
            return None
        return {"parts": [{
            "part": 0,
            "start": [{"who": "harry", "spot": "hide_harry"}, {"who": "ron", "spot": "hide_ron"}, {"who": "dumbledore", "spot": "auto_1"}],
            "enter": [{"who": "troll", "line": 2, "spot": "nowhere"}],
            "lines": [
                {"line": 1, "do": [{"action": "drag", "who": "harry", "target": "ron", "object": ""}, {"action": "teleport", "who": "ron", "target": "", "object": ""}], "move": []},
                {"line": 99, "do": [], "move": [{"who": "ron", "to": "auto_2"}]},
            ],
        }]}  # fmt: skip


def test_a_staging_plan_places_people_and_picks_actions(halloween):
    catalog, ch = halloween
    director = Director(StagingModel())
    story = build_chapter(ch, catalog, "Fixture", director=director)[0]
    first = story["scenes"][story["start"]]
    assert first["cast"] == {"harry": "hide_harry", "ron": "hide_ron"}
    assert {"act": "drag", "actor": "harry", "target": "ron"} in first["beats"]
    # Not in the scene, no such action, no such line. An unknown spot becomes a free one.
    assert director.dropped == 3
    assert {"spawn": "troll", "at": "auto_1"} in first["beats"] or any(b.get("spawn") == "troll" for b in first["beats"])
    narrated = [b["narrate"] for b in first["beats"] if "narrate" in b]
    assert any(t.startswith("Harry grabbed Ron's sleeve") for t in narrated)  # the book's sentence


def test_parts_without_a_plan_keep_the_rules(halloween):
    catalog, ch = halloween
    staged = build_chapter(ch, catalog, "Fixture", director=Director(StagingModel()))[0]
    rules = build_chapter(ch, catalog, "Fixture")[0]
    last = f"scene_{len([k for k in rules['scenes'] if not k.endswith('_wrong')])}"
    assert staged["scenes"][last]["cast"] == rules["scenes"][last]["cast"]


class ActingModel:
    """Acts the first part: a shot, a gesture and mood, a reaction and an exit."""

    def __call__(self, system, label, items, schema):
        if "beats" in schema["properties"]:
            return None
        none = {"type": "", "on": "", "with": ""}
        return {"parts": [{
            "part": 0,
            "start": [{"who": "harry", "spot": "start_harry"}, {"who": "ron", "spot": "start_ron"}],
            "enter": [],
            "lines": [
                {"line": 4, "shot": {"type": "close", "on": "harry", "with": ""}, "look": [{"who": "harry", "at": "ron"}], "move": [], "do": [],
                 "gesture": "point", "mood": "urgent", "react": [{"who": "ron", "clip": "cower"}, {"who": "ron", "clip": "moonwalk"}], "exit": []},
                {"line": 5, "shot": none, "look": [], "move": [], "do": [], "gesture": "", "mood": "", "react": [], "exit": ["ron"]},
                {"line": 6, "shot": none, "look": [{"who": "harry", "at": "ron"}], "move": [], "do": [], "gesture": "wave", "mood": "scared", "react": [], "exit": []},
            ],
        }]}  # fmt: skip


def test_lines_are_acted_with_shots_gestures_reactions_and_exits(halloween):
    catalog, ch = halloween
    director = Director(ActingModel(), beats=False)
    beats = build_chapter(ch, catalog, "Fixture", director=director)[0]["scenes"]["scene_1"]["beats"]
    said = [b for b in beats if b.get("say") == "harry"]
    assert said[0]["anim"] == "point" and said[0]["mood"] == "urgent"
    assert {"camera": "close", "on": "harry", "ms": 600} in beats
    assert {"anim": "ron", "clip": "cower", "async": True} in beats
    assert {"despawn": "ron"} in beats
    # After Ron leaves, Harry cannot look at him; an unknown clip is dropped too.
    assert beats.index({"despawn": "ron"}) > beats.index(said[0])
    assert said[1]["anim"] == "wave" and director.dropped == 2


def test_two_people_never_walk_to_the_same_spot():
    from pipeline.director.staging import Checker

    catalog = {"actions": []}
    checker = Checker(catalog, {"harry": "human", "ron": "human"}, ["auto_1", "auto_2", "at_table"], {0: None})
    plan = checker.plan({"start": [{"who": "harry", "spot": "auto_1"}, {"who": "ron", "spot": "auto_2"}], "enter": [], "lines": [
        {"line": 0, "shot": {}, "look": [], "do": [], "gesture": "", "mood": "", "react": [], "exit": [],
         "move": [{"who": "harry", "to": "at_table", "run": False}, {"who": "ron", "to": "at_table", "run": False}, {"who": "harry", "to": "at_table", "run": False}]}]})  # fmt: skip
    assert plan.lines[0] == [{"move": "harry", "to": "at_table"}, {"move": "ron", "to": "harry"}]


class CrowdModel:
    """Asks for a mixed crowd of three in the first part, and keeps the request."""

    def __init__(self):
        self.items = None

    def __call__(self, system, label, items, schema):
        if "beats" in schema["properties"]:
            return None
        self.items = items
        return {"parts": [{"part": 0, "crowd": {"count": 3, "kind": "mixed"}, "start": [{"who": "harry", "spot": "start_harry"}], "enter": [], "lines": []}]}


def test_a_crowd_fills_the_background_and_the_model_sees_the_book(halloween):
    catalog, ch = halloween
    model = CrowdModel()
    story = build_chapter(ch, catalog, "Fixture", director=Director(model, beats=False))[0]
    cast = story["scenes"]["scene_1"]["cast"]
    assert cast["extra_student_1"] == "crowd_1" and cast["extra_adult_2"] == "crowd_2" and cast["extra_student_3"] == "crowd_3"
    assert story["actors"]["extra_student_1"]["outfit"] == "student"
    assert not any(b.get("say", "").startswith("extra_") for s in story["scenes"].values() for b in s["beats"])
    part = model.items[1]
    assert "Torches flickered" in part["context"] and not any(s.startswith("crowd_") for s in part["spots"])
