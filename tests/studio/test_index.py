"""The model wrapper, the book index and retrieval, with a scripted model."""

import pytest

from studio.index import BookIndex, Indexer, scene_errors
from studio.llm import Model, ModelError, obj, S
from studio.rag import Evidence

from .conftest import FakeModel

INN = {"summary": "Elena hires Captain Rourke.", "people": [{"name": "Rourke", "aliases": ["Captain Rourke"], "looks": "tall, grey beard"}],
       "scenes": [{"first": 0, "last": 8, "place": "the Harbour Inn", "time": "night", "present": ["Elena", "Rourke"], "summary": "Elena meets Rourke."}]}  # fmt: skip
STORM = {"summary": "A storm hits the ship.", "people": [{"name": "Elena", "aliases": [], "looks": ""}],
         "scenes": [{"first": 0, "last": 3, "place": "the deck", "time": "night", "present": ["Elena"], "summary": "Waves."},
                    {"first": 4, "last": 7, "place": "the deck", "time": "night", "present": ["Elena", "Rourke"], "summary": "Elena saves a sailor."}]}  # fmt: skip
CAST = {"synopsis": "Elena sails with Rourke.", "cast": [
    {"id": "elena", "name": "Elena", "aliases": [], "role": "heroine", "looks": ""},
    {"id": "rourke", "name": "Rourke", "aliases": ["Captain Rourke"], "role": "captain", "looks": "tall, grey beard"}]}  # fmt: skip


def test_answers_are_cached_and_counted(tmp_path):
    fake = FakeModel({"Say": [{"x": "ok"}]})
    model = Model(fake, tmp_path / "cache.json")
    assert model.ask("sys", "Say", [1], obj({"x": S})) == {"x": "ok"}
    again = Model(fake, tmp_path / "cache.json")
    again.ask("sys", "Say", [1], obj({"x": S}))
    assert len(fake.prompts) == 1 and again.ledger.totals()["cached"] == 1
    assert model.ledger.totals()["cost_usd"] == 0.01


def test_a_wrong_answer_is_sent_back_with_its_errors():
    fake = FakeModel({"Count": [{"x": "two"}, {"x": "2"}]})
    model = Model(fake)
    check = lambda a: [] if a["x"].isdigit() else ["x must be digits"]  # noqa: E731
    assert model.ask("sys", "Count", [], obj({"x": S}), check=check) == {"x": "2"}
    assert "x must be digits" in fake.prompts[1][1] and model.ledger.calls[0].repairs == 1


def test_an_answer_that_stays_wrong_is_an_error():
    model = Model(FakeModel({"Count": [{"x": "two"}]}))
    with pytest.raises(ModelError):
        model.ask("sys", "Count", [], obj({"x": S}), check=lambda a: ["still wrong"], repairs=1)


def test_scenes_must_cover_every_paragraph_in_order():
    assert scene_errors([{"first": 0, "last": 3}, {"first": 4, "last": 7}], 8) == []
    errors = scene_errors([{"first": 0, "last": 2}, {"first": 4, "last": 6}], 8)
    assert any("paragraph 3" in e for e in errors) and any("last paragraph is 7" in e for e in errors)


def test_the_index_is_a_tree_of_chapters_scenes_and_a_cast(voyage, tmp_path):
    bad_inn = {**INN, "scenes": [{**INN["scenes"][0], "last": 5}]}
    fake = FakeModel({"Index chapter 1": [bad_inn, INN], "Index chapter 2": [STORM], "Merge": [CAST]})
    index = Indexer(Model(fake)).build(voyage)
    assert [s.id for s in index.chapters[1].scenes] == ["c2.s1", "c2.s2"]
    assert index.scene("c2.s2")[1].present == ["Elena", "Rourke"] and index.scene("c9.s1") is None
    assert {p.id for p in index.cast} == {"elena", "rourke"}
    assert "[c1.s1] the Harbour Inn; Elena, Rourke" in index.outline()
    index.save(tmp_path / "i.json")
    assert BookIndex.load(tmp_path / "i.json").cast[1].looks == "tall, grey beard"


def test_evidence_navigates_then_quotes_with_citations(voyage):
    fake = FakeModel({"Index chapter 1": [INN], "Index chapter 2": [STORM], "Merge": [CAST],
                      "Questions": [{"picks": [{"id": "rourke", "scenes": ["c1.s1"]}]}]})  # fmt: skip
    model = Model(fake)
    index = Indexer(model).build(voyage)
    quotes = Evidence(model, index, voyage).find([{"id": "rourke", "question": "What does Rourke look like?", "query": "grey beard tall"}], per=2)
    assert quotes["rourke"][0].chapter == 0 and any("grey beard" in q.text for q in quotes["rourke"])
    assert quotes["rourke"][0].cite().startswith("[c1 p")
