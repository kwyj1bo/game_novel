"""python -m studio <command> <book folder>

index    build the book index (PageIndex tree + cast) into <book>/studio/index.json
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from .index import BookIndex, Indexer
from .llm import Model

LIBRARY = Path(__file__).resolve().parent.parent / "library"


def load_book(folder: Path):
    """Chapters saved by the upload step (one <n>-<title>.text.json each)."""
    from pipeline.text import Chapter

    return [Chapter(**json.loads(p.read_text())) for p in sorted(folder.glob("*.text.json"))]


def model() -> Model:
    return Model(cache=LIBRARY / "studio-cache.json")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="studio", description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=["index"])
    ap.add_argument("book", type=Path)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    m = model()
    chapters = load_book(args.book)
    if args.command == "index":
        out = args.book / "studio" / "index.json"
        index = Indexer(m).build(chapters)
        index.save(out)
        BookIndex.load(out)  # round-trips
        print(f"{out}: {len(index.chapters)} chapters, {sum(len(c.scenes) for c in index.chapters)} scenes, {len(index.cast)} people")
    print(json.dumps(m.ledger.totals()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
