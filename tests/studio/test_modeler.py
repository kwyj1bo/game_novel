"""The modeller's and animator's checks, and their answers turned into engine specs."""

from studio.llm import Model
from studio.modeler import MUST_COVER, Modeler, character_errors, clip_errors, to_clip

from .conftest import FakeModel


def part(joint, shape="capsule", size=(0.1, 0.3, 0.1), offset=(0, -0.1, 0), color="#553322"):
    return {"joint": joint, "shape": shape, "size": list(size), "offset": list(offset), "rotation": [0, 0, 0], "color": color, "roughness": 0.8, "metal": 0, "glow": False}


BODY = {"rig": {"height": 1.7, "shoulders": 1, "hips": 1, "arms": 1, "legs": 1},
        "parts": [part(j) for j in MUST_COVER] + [part("head", "sphere", (0.05, 0.05, 0.05), (0.04, 0.12, 0.1), "#ffffff")]}  # fmt: skip
POSE0 = {k: 0 for k in ("raise", "spread", "twist", "bend", "lift", "nod", "turn", "tilt", "lean")}
PROP = {"parts": [part("root", "box", (0.1, 0.1, 0.1), (0, 0.05, 0))]}


def key(t, **joints):
    return {"t": t, "joints": [{"joint": j, "pose": {**POSE0, **p}} for j, p in joints.items()], "drop": 0}


def action_clip(name):
    return {"name": name, "duration": 1.6, "loop": False, "keys": [key(0, right_arm={}), key(0.8, right_arm={"raise": 70}, right_forearm={"bend": 20}), key(1.6, right_arm={})]}


CLIPS = {"clips": [{"name": n, "duration": 1.2, "loop": True, "keys": [key(0, head={}), key(1.2, head={"nod": 5})]} for n in ("idle", "walk", "talk")]}


def test_a_character_must_cover_every_limb_and_fit_its_height():
    assert character_errors({"characters": [{**BODY, "id": "a"}]}, {"a": 1.7}) == []
    bad = {**BODY, "id": "a", "rig": {**BODY["rig"], "height": 3}, "parts": [x for x in BODY["parts"] if x["joint"] != "head"] + [part("tail"), part("chest")]}
    found = character_errors({"characters": [bad]}, {"a": 1.7})
    assert "a: rig height should be about 1.7 m" in found
    assert any("no part on head" in e for e in found) and any("joint 'tail'" in e for e in found)


def test_clips_stay_inside_joint_ranges_and_in_order():
    assert clip_errors([action_clip("give")], {"give"}) == []
    bad = action_clip("give")
    bad["keys"][1]["joints"][1]["pose"]["bend"] = 200  # an elbow bent past 150
    bad["keys"][1]["joints"].append({"joint": "right_shin", "pose": {**POSE0, "raise": 30}})  # knees do not raise
    bad["keys"][2]["t"] = 0.5
    found = clip_errors([bad], {"give", "wave"})
    assert "missing clip wave" in found
    assert any("right_forearm bend 200 is outside (0, 150)" in e for e in found)
    assert any("right_shin has no 'raise'" in e for e in found)
    assert any("must rise" in e for e in found)


def test_answers_become_engine_clips_without_zero_controls():
    c = to_clip(action_clip("give"))
    assert c["keys"][1]["joints"] == {"right_arm": {"raise": 70}, "right_forearm": {"bend": 20}}
    assert c["keys"][0]["joints"] == {"right_arm": {}} and "drop" not in c["keys"][0]


def test_the_modeler_repairs_a_character():
    bad = {**BODY, "id": "elena", "parts": [x for x in BODY["parts"] if x["joint"] != "head"] + [part("chest"), part("chest")]}
    fake = FakeModel({"Model characters": [{"characters": [bad]}, {"characters": [{**BODY, "id": "elena"}]}]})
    from studio.bible import CharacterDesign

    out = Modeler(Model(fake)).characters([CharacterDesign("elena", "a young woman", "cloak", 1.7, False, "", [], "")])
    assert len(out["elena"]["parts"]) == len(BODY["parts"]) and "no part on head" in fake.prompts[1][1]
