"""The pairwise judge: position bias cancels, and scripts read like the game."""

from studio.evaluate import grounding, judge, script_of_story
from studio.llm import Model

from .conftest import FakeModel
from .test_screenplay import INDEX

STORY = {"start": "s1", "actors": {"elena": {"name": "Elena"}}, "scenes": {
    "s1": {"location": "inn", "title": "The Inn", "beats": [{"narrate": "Rain."}, {"say": "elena", "text": "Tonight."}],
           "choice": {"prompt": "Pay?", "options": [{"label": "Pay", "correct": True, "goto": "s2"}, {"label": "Leave", "correct": False, "goto": "w"}]}},
    "s2": {"location": "deck", "beats": [{"narrate": "They sail."}], "ending": {"kind": "victory", "title": "", "text": ""}},
    "w": {"location": "inn", "beats": [], "ending": {"kind": "failure", "title": "", "text": ""}}}}  # fmt: skip


def test_a_script_follows_the_right_path():
    assert script_of_story(STORY) == ["-- The Inn", "Rain.", "Elena: Tonight.", "[choice] Pay? / Pay / Leave", "-- deck", "They sail."]


def test_a_win_counts_only_when_both_orders_agree():
    first = {"faithfulness": "A", "plot": "A", "clarity": "A", "overall": "A", "why": "a"}
    second = {"faithfulness": "B", "plot": "A", "clarity": "tie", "overall": "B", "why": "b"}
    r = judge(Model(FakeModel({"Judge chapter 1 (order 1)": [first], "Judge chapter 1 (order 2)": [second]})), INDEX, 0, ["x"], ["y"])
    # Order 2 shows the scripts swapped: its "B" is the first script.
    assert r["faithfulness"] == "first" and r["overall"] == "first"
    assert r["plot"] == "tie" and r["clarity"] == "tie"


def test_grounding_counts_cited_designs():
    assert grounding({"characters": [{"cites": ["q1"]}, {"cites": []}], "places": [{"cites": ["q2"]}]}) == {"designs": 3, "cited": 2, "share": 0.667}
