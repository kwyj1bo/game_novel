"""The screenplay agent's checks, the self-correction loop and the preview."""

import json

from pipeline.__main__ import validate
from studio.index import BookIndex, Chapter, Person, Scene
from studio.llm import Model
from studio.preview import to_story
from studio.screenplay import ScreenplayWriter, errors

from .conftest import FakeModel

INDEX = BookIndex("A sea story.", [Chapter("The Harbour Inn", "Elena hires Rourke.", [Scene("c1.s1", 0, 8, "inn", "night", ["Elena", "Rourke"], "They meet.")], [])],
                  [Person("elena", "Elena", [], "heroine", ""), Person("rourke", "Rourke", ["Captain Rourke"], "captain", "grey beard")])  # fmt: skip
CAST = {"elena", "rourke"}


def beat(kind, who="", text="", to="", obj="", mood=""):
    return {"kind": kind, "who": who, "to": to, "text": text, "mood": mood, "object": obj}


GOOD = {"title": "The Harbour Inn", "objects": [{"id": "coins", "name": "a purse", "description": "a small leather purse of silver"}],
        "scenes": [{"id": "inn", "place": "harbour_inn", "place_description": "a loud, smoky tavern", "time": "night", "cast": ["elena"],
                    "beats": [beat("narrate", text="The tavern was loud."), beat("enter", "rourke"),
                              beat("say", "elena", "I need passage tonight.", "rourke", mood="urgent"),
                              beat("do", "elena", "hands Rourke a purse of silver", "rourke", "coins"),
                              beat("say", "rourke", "We leave at midnight.", "elena")],
                    "choices": [{"after_beat": 2, "prompt": "Rourke names his price. What does Elena do?", "options": [
                        {"label": "Pay him", "correct": True, "consequence": []},
                        {"label": "Walk away", "correct": False, "consequence": [beat("exit", "elena"), beat("narrate", text="No other ship sails.")]}]}]}]}  # fmt: skip


def test_a_clean_screenplay_has_no_errors():
    assert errors(GOOD, CAST) == []


def test_the_checker_names_each_problem():
    bad = json.loads(json.dumps(GOOD))
    s = bad["scenes"][0]
    s["beats"].insert(0, beat("say", "rourke", "Hello."))  # before he enters
    s["beats"].append(beat("do", "elena", "draws a knife", obj="knife"))  # unknown object
    s["beats"].append(beat("say", "hagrid", "Hi."))  # not in the cast
    s["choices"][0]["options"][1]["correct"] = True  # two right answers
    found = errors(bad, CAST)
    assert any("rourke acts but is not in the scene" in e for e in found)
    assert any("'knife' is not in the objects list" in e for e in found)
    assert any("'hagrid' is not a cast id" in e for e in found)
    assert any("one correct" in e for e in found)


def test_the_writer_repairs_its_screenplay(voyage):
    broken = json.loads(json.dumps(GOOD))
    broken["scenes"][0]["cast"] = []
    fake = FakeModel({"Write the screenplay": [broken, GOOD]})
    sp = ScreenplayWriter(Model(fake), INDEX).write(0, voyage[0])
    assert sp.scenes[0]["beats"][1]["kind"] == "enter" and len(fake.prompts) == 2
    assert "elena acts but is not in the scene" in fake.prompts[1][1]


def test_the_preview_is_a_valid_story(tmp_path, voyage):
    sp = ScreenplayWriter(Model(FakeModel({"Write": [GOOD]})), INDEX).write(0, voyage[0])
    story = to_story(sp, {"elena": "Elena", "rourke": "Rourke"}, "Fixture")
    assert story["scenes"]["scene_1"]["choice"]["options"][1]["goto"] == "scene_1_wrong"
    assert {"narrate": "Elena hands Rourke a purse of silver"} in story["scenes"]["scene_2"]["beats"]
    path = tmp_path / "s.story.json"
    path.write_text(json.dumps(story))
    assert validate(path)
