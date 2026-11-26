"""The bible agents: grounded designs, and citations they cannot invent."""

from studio.bible import Designer
from studio.index import Indexer
from studio.llm import Model
from studio.rag import Evidence

from .conftest import FakeModel
from .test_index import CAST, INN, STORM

PICK = {"picks": [{"id": "rourke", "scenes": ["c1.s1"]}, {"id": "elena", "scenes": ["c1.s1"]}]}
DESIGN = {"designs": [
    {"id": "rourke", "prompt": "a tall sea captain with a grey beard", "texture": "worn blue coat", "height_m": 1.9, "quadruped": False, "voice": "deep male", "cites": ["q1"], "invented": "coat colour"},
    {"id": "elena", "prompt": "a young woman soaked by rain", "texture": "wet travelling cloak", "height_m": 1.65, "quadruped": False, "voice": "young female", "cites": [], "invented": "most of it"}]}  # fmt: skip


def test_characters_are_designed_from_quotes_and_cite_only_those(voyage):
    bad = {"designs": [{**DESIGN["designs"][0], "cites": ["q99"]}, DESIGN["designs"][1]]}
    fake = FakeModel({"Index chapter 1": [INN], "Index chapter 2": [STORM], "Merge": [CAST], "Questions": [PICK], "Design the characters": [bad, DESIGN]})
    model = Model(fake)
    index = Indexer(model).build(voyage)
    designs = Designer(model, Evidence(model, index, voyage)).characters(index.cast)
    assert {d.id: d.height_m for d in designs} == {"rourke": 1.9, "elena": 1.65}
    asked = next(p for t, p in fake.prompts if t == "Design the characters")
    assert "grey beard" in asked and "q1" in asked
    assert "rourke cites q99, which is not one of its quotes" in fake.prompts[-1][1]
