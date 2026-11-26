"""Production: what the scripts need, clip casting, the estimate and generation."""

from studio.bible import CharacterDesign, ObjectDesign, PlaceDesign
from studio.index import Person
from studio.llm import Model
from studio.meshy import AssetStore, Meshy
from studio.production import Production, needs
from studio.screenplay import Screenplay

from .conftest import FakeModel
from .test_meshy import FakeHttp
from .test_screenplay import GOOD

LIBRARY = [{"action_id": 0, "name": "Idle", "rig_type": "biped"}, {"action_id": 1, "name": "Walking", "rig_type": "biped"},
           {"action_id": 2, "name": "Talking", "rig_type": "biped"}, {"action_id": 40, "name": "Hand_Over_Item", "rig_type": "biped"},
           {"action_id": 1058, "name": "cat_run", "rig_type": "quadruped"}]  # fmt: skip
SP = Screenplay(GOOD["title"], GOOD["objects"], GOOD["scenes"])


class StubDesigner:
    def characters(self, people):
        return [CharacterDesign(p.id, f"{p.name}, full body", "clothes", 1.7, False, "", [], "") for p in people]

    def places(self, places):
        return [PlaceDesign(p["id"], True, [10, 8], "wood", "stone", "warm", [{"id": "bar", "prompt": "a long oak bar", "count": 1, "where": "back wall", "size_m": 4}], [], "") for p in places]

    def objects(self, objects):
        return [ObjectDesign(o["id"], o["description"], 0.15, True, []) for o in objects]


def test_needs_lists_people_actions_places_and_objects():
    n = needs([SP])
    assert n["people"]["elena"] == ["hands Rourke a purse of silver"] and "rourke" in n["people"]
    assert n["places"] == [{"id": "harbour_inn", "description": "a loud, smoky tavern"}] and n["objects"][0]["id"] == "coins"


def test_a_plan_casts_clips_estimates_and_generates(tmp_path):
    bad = {"characters": [{"id": "elena", "clips": [{"use": "idle", "action_id": 1058}]}]}
    good = {"characters": [{"id": "elena", "clips": [{"use": "idle", "action_id": 0}, {"use": "walk", "action_id": 1}, {"use": "talk", "action_id": 2},
                                                      {"use": "hands Rourke a purse of silver", "action_id": 40}]},
                           {"id": "rourke", "clips": [{"use": "idle", "action_id": 0}, {"use": "walk", "action_id": 1}, {"use": "talk", "action_id": 2}]}]}  # fmt: skip
    fake = FakeModel({"Cast the clips": [bad, good]})
    index = type("I", (), {"cast": [Person("elena", "Elena", [], "", ""), Person("rourke", "Rourke", [], "", "")]})()
    prod = Production(Model(fake), StubDesigner(), index, Meshy(AssetStore(tmp_path), FakeHttp(), key="test-key"))
    plan = prod.plan([SP], LIBRARY)
    assert plan["clips"]["elena"]["hands Rourke a purse of silver"] == 40
    assert "action 1058 is for a quadruped rig" in fake.prompts[1][1]
    assert plan["estimate_credits"] == 2 * 20 + 7 * 3 + 2 * 15
    assets = prod.generate(plan)
    assert set(assets["characters"]) == {"elena", "rourke"} and set(assets["props"]) == {"coins", "harbour_inn.bar"}
