"""Retrieval for the AI steps: hybrid search (BM25 + embeddings) and a
PageIndex-style tree that a model navigates."""

from .search import BM25, Passage, SearchIndex, book_passages, default_encoder, rrf
from .tree import BookTree, Node

__all__ = ["BM25", "BookTree", "Node", "Passage", "SearchIndex", "book_passages", "default_encoder", "rrf"]
