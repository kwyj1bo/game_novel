import os

# Tests never call the AI asset model; looks come from the fake client in test_assetgen.
os.environ.setdefault("NOVEL_ASSET_AI", "0")
# Search runs BM25 only in tests: no embedding model download, same result everywhere.
os.environ.setdefault("NOVEL_EMBEDDINGS", "0")
