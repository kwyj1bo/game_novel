"""The director agent's checks, and the assembled story the engine plays."""

import json

from pipeline.__main__ import validate
from studio.assemble import Assembler, clip_names
from studio.director import Director, staging_errors
from studio.llm import Model
from studio.screenplay import Screenplay

from .conftest import FakeModel
from .test_screenplay import GOOD

SP = Screenplay(GOOD["title"], GOOD["objects"], GOOD["scenes"])
SETS = {"harbour_inn": {"size_m": [10, 8], "pieces": [{"piece": "bar", "x": 0, "z": -3.5, "yaw": 0}]}}
USES = {"elena": ["idle", "walk", "talk", "hands Rourke a purse of silver"], "rourke": ["idle", "walk", "talk"]}


def staged_beat(i, **kw):
    return {"beat": i, "shot": "", "on": "", "with": "", "moves": [], "looks": [], "perform": [], "props": [], **kw}


STAGING = {"scenes": [{"scene": "inn", "start": [{"who": "elena", "x": -1, "z": 1}], "beats": [
    staged_beat(0, shot="wide"),
    staged_beat(1, moves=[{"who": "rourke", "x": 1, "z": 1, "to": "", "run": False}]),
    staged_beat(2, shot="two", on="elena", **{"with": "rourke"}, looks=[{"who": "elena", "at": "rourke"}], perform=[{"who": "elena", "use": "talk"}]),
    staged_beat(3, props=[{"op": "take", "prop": "coins", "who": "elena", "to": "", "x": 0, "z": 0}, {"op": "give", "prop": "coins", "who": "elena", "to": "rourke", "x": 0, "z": 0}],
                perform=[{"who": "elena", "use": "hands Rourke a purse of silver"}]),
    staged_beat(4, shot="close", on="rourke")]}]}  # fmt: skip


def test_clean_staging_passes_the_checks():
    assert staging_errors(STAGING, SP, SETS, USES, {"coins"}) == []


def test_the_checks_catch_impossible_staging():
    bad = json.loads(json.dumps(STAGING))
    beats = bad["scenes"][0]["beats"]
    beats[0]["moves"] = [{"who": "rourke", "x": 0, "z": 0, "to": "", "run": False}]  # before he enters
    beats[2]["perform"] = [{"who": "elena", "use": "backflip"}]  # no such clip
    beats[3]["props"] = [{"op": "give", "prop": "coins", "who": "elena", "to": "rourke", "x": 0, "z": 0}]  # never taken
    beats[4]["moves"] = [{"who": "elena", "x": 40, "z": 0, "to": "", "run": True}]  # through the wall
    found = staging_errors(bad, SP, SETS, USES, {"coins"})
    assert any("rourke moves but is not here" in e for e in found)
    assert any("no clip for 'backflip'" in e for e in found)
    assert any("gives coins without holding it" in e for e in found)
    assert any("walks outside the set" in e for e in found)


def test_the_director_lays_out_and_stages_with_repairs():
    bad_layout = {"sets": [{"place": "harbour_inn", "pieces": [{"piece": "bar", "x": 20, "z": 0, "yaw": 0}]}]}
    good_layout = {"sets": [{"place": "harbour_inn", "pieces": [{"piece": "bar", "x": 0, "z": -3.5, "yaw": 0}]}]}
    fake = FakeModel({"Lay out": [bad_layout, good_layout], "Stage": [STAGING]})
    d = Director(Model(fake))
    layout = d.layout([{"id": "harbour_inn", "size_m": [10, 8], "pieces": [{"id": "bar", "count": 1, "where": "back wall", "size_m": 4}]}])
    assert layout["harbour_inn"][0]["z"] == -3.5 and "outside the 10 x 8 set" in fake.prompts[1][1]
    staging = d.stage(SP, SETS, USES, {"coins"})
    assert staging["inn"]["start"] == {"elena": [-1, 1]} and staging["inn"]["beats"][3]["props"][1]["op"] == "give"


def test_the_assembled_story_is_valid_and_hands_over_the_coins(tmp_path):
    staging = {s["scene"]: {"start": {x["who"]: [x["x"], x["z"]] for x in s["start"]}, "beats": {b["beat"]: b for b in s["beats"]}} for s in STAGING["scenes"]}
    assets = {"characters": {"elena": {"rig": {"rigged": "rig-1/rigged.glb"}, "clips": {"clips_0": "clips-1/clips_0.glb"}, "height_m": 1.65}},
              "props": {"coins": {"model": {"model": "model-1/model.glb"}, "size_m": 0.15, "held": True},
                        "harbour_inn.bar": {"model": {"model": "model-2/model.glb"}, "size_m": 4}}}  # fmt: skip
    designs = {"characters": [{"id": "elena", "voice": "young female"}], "objects": [{"id": "coins"}],
               "places": [{"id": "harbour_inn", "indoor": True, "size_m": [10, 8], "floor_color": "#5a4030", "wall_color": "#7a6a5a", "light": "night"}]}  # fmt: skip
    uses = clip_names({"elena": {"idle": 0, "talk": 2, "hands Rourke a purse of silver": 40}}, [{"action_id": 0, "name": "Idle"}, {"action_id": 2, "name": "Talking"}, {"action_id": 40, "name": "Hand_Over"}])
    story = Assembler({"elena": "Elena", "rourke": "Rourke"}, designs, assets, uses, {"harbour_inn": SETS["harbour_inn"]["pieces"]}).story(SP, staging, "inn", "Fixture")
    beats = story["scenes"]["scene_2"]["beats"]
    assert {"take": "coins", "actor": "elena"} in beats and {"give": "coins", "from": "elena", "to": "rourke"} in beats
    assert beats.index({"perform": "elena", "use": "hands Rourke a purse of silver"}) < beats.index({"give": "coins", "from": "elena", "to": "rourke"})
    assert story["actors"]["elena"]["model"]["uses"]["talk"] == "Talking" and "model" not in story["actors"]["rourke"]
    assert story["sceneries"]["set_harbour_inn"]["set"]["pieces"][0]["at"] == [0, -3.5]
    path = tmp_path / "s.story.json"
    path.write_text(json.dumps(story))
    assert validate(path)
