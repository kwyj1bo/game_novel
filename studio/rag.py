"""Retrieval with citations: the quotes an agent gets as evidence.

Two stages, as in production RAG systems: a coarse step that reasons over the
book's structure (PageIndex navigation picks scenes), then a fine step that
ranks sentences inside them (hybrid BM25 + embedding search, fused with RRF).
Every quote keeps its chapter and paragraph, so answers can cite the book.
"""

from dataclasses import dataclass

from pipeline.rag.search import SearchIndex

from .index import BookIndex, navigate
from .llm import Model


@dataclass(frozen=True)
class Quote:
    chapter: int
    para: int
    text: str

    def cite(self) -> str:
        return f"[c{self.chapter + 1} p{self.para}] {self.text}"


class Evidence:
    def __init__(self, model: Model, index: BookIndex, chapters, search: SearchIndex | None = None):
        self.model, self.index = model, index
        self.search = search or SearchIndex.of_book(chapters)

    def find(self, questions: list[dict], per: int = 6) -> dict[str, list[Quote]]:
        """Question id -> up to `per` quotes, in book order. A question is
        {"id", "question", "query"}: the question guides navigation, the
        query (keywords) ranks sentences."""
        picks = navigate(self.model, self.index, [{"id": q["id"], "question": q["question"]} for q in questions])
        out = {}
        for q in questions:
            keys = [(c, p) for sid in picks.get(q["id"], []) if (hit := self.index.scene(sid)) for c, sc in [hit] for p in range(sc.first, sc.last + 1)]
            within = self.search.in_paragraphs(keys) if keys else None
            best = self.search.search(q.get("query") or q["question"], per, within)
            out[q["id"]] = [Quote(self.search.passages[i].chapter, self.search.passages[i].para, self.search.passages[i].text) for i in sorted(best)]
        return out
