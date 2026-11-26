"""Production: what the scripts need, and models and clips made by the modeller."""

from studio.bible import CharacterDesign, ObjectDesign, PlaceDesign
from studio.index import Person
from studio.llm import Model
from studio.modeler import Modeler
from studio.production import Production, needs
from studio.screenplay import Screenplay

from .conftest import FakeModel
from .test_modeler import BODY, CLIPS, PROP, action_clip
from .test_screenplay import GOOD

SP = Screenplay(GOOD["title"], GOOD["objects"], GOOD["scenes"])


class StubDesigner:
    def characters(self, people):
        return [CharacterDesign(p.id, f"{p.name}, full body", "clothes", 1.7, False, "female", [], "") for p in people]

    def places(self, places):
        return [PlaceDesign(p["id"], True, [10, 8], "wood", "stone", "#5a4030", "#7a6a5a", "night",
                            [{"id": "bar", "prompt": "a long oak bar", "count": 1, "where": "back wall", "size_m": 4}], [], "") for p in places]  # fmt: skip

    def objects(self, objects):
        return [ObjectDesign(o["id"], o["description"], 0.15, True, []) for o in objects]


def test_needs_lists_people_actions_places_and_objects():
    n = needs([SP])
    assert n["people"]["elena"] == ["hands Rourke a purse of silver"] and "rourke" in n["people"]
    assert n["places"] == [{"id": "harbour_inn", "description": "a loud, smoky tavern"}] and n["objects"][0]["id"] == "coins"


def test_production_builds_every_character_object_and_piece():
    fake = FakeModel({
        "Model characters": [{"characters": [{**BODY, "id": "elena"}, {**BODY, "id": "rourke"}]}],
        "Write the base clips": [CLIPS],
        "Write a clip for each action": [{"clips": [action_clip("hands_rourke_a_purse_of_silver")]}],
        "Model the objects": [{"props": [{**PROP, "id": "coins"}]}],
        "Model the set pieces": [{"props": [{**PROP, "id": "bar"}]}],
    })  # fmt: skip
    index = type("I", (), {"cast": [Person("elena", "Elena", [], "", ""), Person("rourke", "Rourke", [], "", "")]})()
    prod = Production(StubDesigner(), Modeler(Model(fake)), index).run([SP])
    elena = prod["built"]["elena"]
    assert elena["uses"]["hands Rourke a purse of silver"] == "hands_rourke_a_purse_of_silver"
    assert set(elena["clips"]) == {"idle", "walk", "talk", "hands_rourke_a_purse_of_silver"} and "hands Rourke a purse of silver" not in prod["built"]["rourke"]["uses"]
    assert prod["props"]["coins"]["held"] is True and "harbour_inn.bar" in prod["pieces"]
