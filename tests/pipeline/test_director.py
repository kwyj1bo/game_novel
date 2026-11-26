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
        return None


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
