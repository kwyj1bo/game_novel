"""Hybrid search over a book's sentences.

Two rankers look at the same candidates:

- BM25 ranks by shared words, so exact names and rare words count.
- A sentence-embedding model ranks by meaning, so "his hair was ginger" can
  match a question about "red hair".

Their rankings are fused with reciprocal rank fusion (RRF), which needs no
score calibration between the two. Without the embedding package (or with
NOVEL_EMBEDDINGS=0) the search is BM25 only.
"""

import logging
import math
import os
import re
from collections import Counter
from dataclasses import dataclass

log = logging.getLogger(__name__)

EMBEDDING_MODEL = os.environ.get("NOVEL_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
RRF_K = 60  # the usual constant from Cormack et al. (2009)
TOKEN = re.compile(r"[a-z0-9']+")
SENTENCE = re.compile(r"(?<=[.!?”\"])\s+(?=[“\"A-Z])")
STOP = frozenset(
    "a an the and or but of to in on at for with by from as is was were be been it its he she his her him they them "
    "their this that these those there here had has have do did not no so then than too very just said".split()
)


@dataclass(frozen=True)
class Passage:
    chapter: int
    para: int
    text: str


class SearchIndex:
    """Sentences of a book, searchable by BM25 and (optionally) embeddings."""

    def __init__(self, passages: list[Passage], encoder=None):
        self.passages = passages
        self.encoder = encoder
        self._bm25 = BM25([p.text for p in passages])
        self._by_para: dict[tuple[int, int], list[int]] = {}
        for i, p in enumerate(passages):
            self._by_para.setdefault((p.chapter, p.para), []).append(i)

    @classmethod
    def of_book(cls, chapters, encoder="default") -> "SearchIndex":
        return cls(book_passages(chapters), default_encoder() if encoder == "default" else encoder)

    def in_paragraphs(self, keys) -> list[int]:
        """Passage ids of these (chapter, paragraph) pairs, in book order."""
        return sorted(i for k in set(keys) for i in self._by_para.get(k, []))

    def search(self, query: str, k: int, within: list[int] | None = None) -> list[int]:
        """The k best passage ids for the query, best first."""
        ids = list(range(len(self.passages))) if within is None else list(dict.fromkeys(within))
        if not ids:
            return []
        rankings = [self._bm25.rank(query, ids)]
        if self.encoder is not None:
            rankings.append(self._dense_rank(query, ids))
        return rrf(rankings)[:k]

    def _dense_rank(self, query: str, ids: list[int]) -> list[int]:
        import numpy as np

        q = np.asarray(self.encoder.encode([query])[0])
        sims = np.asarray(self.encoder.encode([self.passages[i].text for i in ids])) @ q
        return [ids[j] for j in np.argsort(-sims, kind="stable")]


class BM25:
    """Okapi BM25 (k1 = 1.5, b = 0.75)."""

    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.tf = [Counter(tokens(d)) for d in docs]
        self.len = [sum(t.values()) for t in self.tf]
        self.avg = (sum(self.len) / len(self.len)) if self.len else 1.0
        df = Counter(w for t in self.tf for w in t)
        n = len(docs)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}

    def score(self, query_tokens: list[str], i: int) -> float:
        tf, norm = self.tf[i], self.k1 * (1 - self.b + self.b * self.len[i] / (self.avg or 1.0))
        return sum(self.idf.get(w, 0.0) * tf[w] * (self.k1 + 1) / (tf[w] + norm) for w in query_tokens if w in tf)

    def rank(self, query: str, ids: list[int]) -> list[int]:
        q = tokens(query)
        return sorted(ids, key=lambda i: -self.score(q, i))


class SentenceEncoder:
    """sentence-transformers, loaded on first use; vectors are cached per text."""

    def __init__(self, model: str = EMBEDDING_MODEL):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model)
        self.cache: dict[str, list[float]] = {}

    def encode(self, texts: list[str]) -> list[list[float]]:
        todo = [t for t in dict.fromkeys(texts) if t not in self.cache]
        if todo:
            for t, v in zip(todo, self.model.encode(todo, normalize_embeddings=True, batch_size=64)):
                self.cache[t] = v.tolist()
        return [self.cache[t] for t in texts]


_ENCODER: list = []


def default_encoder():
    """The shared embedding model, or None when it is off or not installed."""
    if os.environ.get("NOVEL_EMBEDDINGS", "1") == "0":
        return None
    if not _ENCODER:
        try:
            _ENCODER.append(SentenceEncoder())
        except Exception as e:  # package missing, or the model cannot be downloaded
            log.warning("embeddings unavailable (%s); search is BM25 only", e)
            _ENCODER.append(None)
    return _ENCODER[0]


def rrf(rankings: list[list[int]], k: int = RRF_K) -> list[int]:
    """Reciprocal rank fusion: each list gives 1 / (k + rank) to its items."""
    score: dict[int, float] = {}
    for ranking in rankings:
        for r, i in enumerate(ranking):
            score[i] = score.get(i, 0.0) + 1.0 / (k + r + 1)
    return sorted(score, key=lambda i: (-score[i], i))


def tokens(text: str) -> list[str]:
    return [w for w in TOKEN.findall(text.lower()) if w not in STOP]


def book_passages(chapters, limit: int = 300) -> list[Passage]:
    """Every sentence of the book, cut to `limit` characters."""
    out = []
    for c, ch in enumerate(chapters):
        for p, para in enumerate(ch.paragraphs):
            for s in SENTENCE.split(para):
                if s.strip():
                    out.append(Passage(c, p, s.strip()[:limit]))
    return out
