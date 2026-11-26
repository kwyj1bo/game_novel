"""Hybrid search, the PageIndex-style tree and the retrievers, without a model."""

from pathlib import Path

import pytest

from pipeline.__main__ import load_catalog
from pipeline.analyze import analyze
from pipeline.rag import BM25, BookTree, Passage, SearchIndex, book_passages, rrf
from pipeline.rag.retrievers import Retriever
from pipeline.text import load_chapters

FIX = Path(__file__).parent / "fixtures"


class WordEncoder:
    """A tiny stand-in for the embedding model: one dimension per topic word."""

    TOPICS = [("beard", "grey", "tall", "hair"), ("storm", "wave", "rain", "sea"), ("tavern", "fire", "hearth", "smoky")]

    def encode(self, texts):
        out = []
        for t in texts:
            v = [sum(w in t.lower() for w in topic) + 0.01 for topic in self.TOPICS]
            n = sum(x * x for x in v) ** 0.5
            out.append([x / n for x in v])
        return out


@pytest.fixture(scope="module")
def voyage():
    catalog = load_catalog()
    chapters = load_chapters(FIX / "voyage.txt")
    return catalog, chapters, [analyze(ch.paragraphs, catalog) for ch in chapters]


def test_bm25_prefers_rare_shared_words():
    bm = BM25(["the cat sat", "a grey beard", "the grey sea"])
    assert bm.rank("grey beard", [0, 1, 2])[0] == 1


def test_rrf_rewards_items_both_lists_rank_high():
    assert rrf([[1, 2, 3], [2, 3, 1]])[0] == 2


def test_hybrid_search_finds_meaning_bm25_misses():
    index = SearchIndex([Passage(0, 0, "A wave hit the ship."), Passage(0, 1, "The captain had a grey beard.")], WordEncoder())
    assert index.search("storm at sea", 1) == [0]  # no shared words, same topic
    assert index.search("grey beard", 2, within=[1]) == [1]


def test_book_passages_are_sentences_with_their_place(voyage):
    _, chapters, _ = voyage
    ps = book_passages(chapters)
    beard = next(p for p in ps if "grey beard" in p.text)
    assert beard.chapter == 0 and beard.text.startswith("A tall man")


def test_tree_is_chapters_scenes_sections(voyage):
    catalog, chapters, analyses = voyage
    tree = BookTree.build(chapters, analyses, catalog)
    assert [c.id for c in tree.root.children] == [f"c{i + 1}" for i in range(len(chapters))]
    leaf = tree.root.children[0].leaves()[0]
    assert leaf.id.startswith("c1.s1.p") and leaf.paras and leaf.summary
    assert "[c1.s1]" in tree.outline(tree.root.children, depth=2)


def test_navigation_goes_down_the_tree_in_two_requests(voyage):
    catalog, chapters, analyses = voyage
    tree = BookTree.build(chapters, analyses, catalog)
    calls = []

    def ask(system, label, items, schema):
        calls.append(items)
        q = items[-1]
        if "outline" in q:  # step two: sections of the chosen scene
            return {"picks": [{"id": q["id"], "nodes": ["c1.s1.p1"]}]}
        return {"picks": [{"id": q["id"], "nodes": ["c1.s1", "nonsense"]}]}

    out = tree.navigate(ask, [{"id": "rourke", "question": "What does Rourke look like?"}])
    assert len(calls) == 2 and "table_of_contents" in calls[0][0]
    assert [n.id for n in out["rourke"]] == ["c1.s1.p1"]


@pytest.mark.parametrize("how", ["keyword", "hybrid"])
def test_look_retrieval_finds_the_description(voyage, how):
    catalog, chapters, analyses = voyage
    rourke = next(c for a in analyses for c in a.characters.values() if c.id == "rourke")
    says = Retriever(chapters, analyses, how, catalog=catalog, encoder=WordEncoder()).looks([rourke])["rourke"]
    assert any("grey beard" in s for s in says)


def test_hybrid_looks_include_the_unnamed_introduction(voyage):
    """The beard sentence never names Rourke; the keyword rule finds it only
    because it is just before his first mention. Hybrid does too."""
    catalog, chapters, analyses = voyage
    rourke = next(c for a in analyses for c in a.characters.values() if c.id == "rourke")
    says = Retriever(chapters, analyses, "hybrid", catalog=catalog, encoder=None).looks([rourke])["rourke"]
    assert says[0].startswith("A tall man with a grey beard")


def test_place_retrieval_keeps_the_budget_and_reading_order(voyage):
    catalog, chapters, analyses = voyage
    scene = {"key": "k", "chapter": 0, "paras": list(range(len(chapters[0].paragraphs))), "start": chapters[0].paragraphs[0]}
    text = Retriever(chapters, analyses, "hybrid", catalog=catalog, encoder=WordEncoder()).places([scene])["k"]
    assert "fire roared" in text and len(text) <= 900


def test_library_hints_rank_similar_places(voyage):
    catalog, chapters, analyses = voyage
    library = {"gen_inn": {"title": "Smoky Tavern", "preset": {"type": "tavern"}}, "gen_deck": {"title": "Storm Deck", "preset": {"type": "deck"}}}
    r = Retriever(chapters, analyses, "hybrid", catalog=catalog, encoder=WordEncoder())
    assert r.library_hints(library, ["waves crashed in the storm"], k=1) == ["gen_deck"]
    assert Retriever(chapters, analyses, "keyword").library_hints(library, ["x"]) == ["gen_inn", "gen_deck"]


def test_a_failed_tree_navigation_falls_back_to_hybrid(voyage):
    catalog, chapters, analyses = voyage
    rourke = next(c for a in analyses for c in a.characters.values() if c.id == "rourke")

    def broken(*_):
        raise RuntimeError("model unavailable")

    says = Retriever(chapters, analyses, "tree", ask=broken, catalog=catalog, encoder=None).looks([rourke])["rourke"]
    assert any("grey beard" in s for s in says)
