"""Measure the story director against the rules.

    python -m pipeline.director.evaluate --book library/<harry potter folder>

Beats: the two hand-made chapters (the troll, the trapdoor) are the
reference for what matters. Each of their lines is matched to the book
paragraph it adapts. A method scores the share of those paragraphs its event
chain keeps (within one paragraph). Names are invented, as in
pipeline.rag.evaluate, so the model cannot pick beats from memory.

Staging: every chapter is built twice, with the rules and with the director.
Both are run through the engine's story validator, and the staging is
counted: people placed on named spots, entrances, lines with an action, and
how many of the model's suggestions passed the checks.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from ..__main__ import ROOT, book_hero, build_chapter, load_catalog
from ..analyze import analyze
from ..assetgen import add_places, asker, default_client
from ..rag.evaluate import WORLD_WORDS, _strip_book_assets, load_book
from ..rag.pseudonym import Pseudonyms
from ..rag.search import BM25, tokens
from . import Director

REFERENCES = {"troll.story.json": "HALLOWEEN", "trapdoor.story.json": "THROUGH THE TRAPDOOR"}
MIN_SHARED = 3  # content words a reference line must share with its paragraph


def reference_paragraphs(story: dict, paragraphs: list[str]) -> set[int]:
    """Paragraphs the hand-made chapter adapts: the best BM25 match of each line."""
    bm = BM25(paragraphs)
    out = set()
    for scene in story["scenes"].values():
        for b in scene["beats"]:
            text = b.get("narrate") or (b.get("text") if "say" in b else None)
            if not text:
                continue
            best = bm.rank(text, list(range(len(paragraphs))))[0]
            if len(set(tokens(text)) & set(tokens(paragraphs[best]))) >= MIN_SHARED:
                out.add(best)
    return out


def recall(chosen: set[int], reference: set[int]) -> float:
    return sum(any(abs(p - c) <= 1 for c in chosen) for p in reference) / (len(reference) or 1)


def evaluate_beats(book, catalog, client) -> dict:
    fake = Pseudonyms.for_catalog(catalog, WORLD_WORDS)
    hidden = _strip_book_assets(catalog)
    out = {}
    for name, title in REFERENCES.items():
        ch = next(c for c in book if c.title.upper() == title)
        ref = reference_paragraphs(json.loads((ROOT / "web/src/content/hp" / name).read_text()), ch.paragraphs)
        fch = fake.chapters([ch])[0]
        row = {"reference_paragraphs": len(ref)}
        for how, director in (("rules", None), ("director", Director(asker(client)))):
            chain = build_chapter(fch, hidden, "Book", analysis=analyze(fch.paragraphs, hidden), director=director)[4]
            kept = {n.para for n in chain}
            row[how] = {"events": len(kept), "recall": round(recall(kept, ref), 3), "paragraphs": sorted(kept)}
        row["reference"] = sorted(ref)
        out[title.title()] = row
        print(name, row, file=sys.stderr)
    return out


def staging_counts(story: dict) -> dict:
    scenes = [s for k, s in story["scenes"].items() if not k.endswith("_wrong")]
    placed = [m for s in scenes for m in s["cast"].values()]
    lines = [b for s in scenes for b in s["beats"] if "narrate" in b or "say" in b]
    acts = sum(1 for s in scenes for b in s["beats"] if "act" in b)
    return {
        "people_placed": len(placed),
        "on_named_spots": sum(not m.startswith("auto_") for m in placed),
        "entrances": sum(1 for s in scenes for b in s["beats"] if "spawn" in b),
        "lines": len(lines),
        "actions": acts,
    }


def validate(story: dict) -> bool:
    with tempfile.NamedTemporaryFile("w", suffix=".story.json", delete=False) as f:
        json.dump(story, f)
    r = subprocess.run(["npx", "vite-node", "scripts/validate-story.ts", f.name], cwd=ROOT / "web", capture_output=True, text=True)
    return r.returncode == 0


def evaluate_staging(book, catalog, client, chapters: list[int], library: Path) -> dict:
    """Builds the chosen chapters as the pipeline does (book hero, the
    library's AI places, the director at its default effort, its cache), so
    chapters already built cost no new requests."""
    analyses = [analyze(ch.paragraphs, catalog) for ch in book]
    hero = book_hero(analyses)
    places = add_places(book, analyses, catalog, library / "assets", client)
    director = Director(asker(client, os.environ.get("NOVEL_DIRECTOR_EFFORT", "high")), library / "assets" / "director.json", beats=False)
    totals = {"rules": {}, "director": {}}
    valid = {"rules": 0, "director": 0}
    picked = [(book[n - 1], analyses[n - 1]) for n in chapters]
    for ch, a in picked:
        for how, d in (("rules", None), ("director", director)):
            story = build_chapter(ch, catalog, "Book", hero, a, places, d)[0]
            valid[how] += validate(story)
            for k, v in staging_counts(story).items():
                totals[how][k] = totals[how].get(k, 0) + v
        print(ch.title, valid, file=sys.stderr)
    return {
        "chapters": chapters,
        "valid_stories": valid,
        "counts": totals,
        "suggestions": {"kept": director.kept, "dropped": director.dropped},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--book", type=Path, required=True)
    ap.add_argument("--task", choices=["beats", "staging", "all"], default="all")
    ap.add_argument("--chapters", default=",".join(str(i) for i in range(1, 18)), help="chapter numbers, comma-separated")
    ap.add_argument("--json", type=Path, default=Path("docs/director.json"))
    args = ap.parse_args(argv)
    catalog, client = load_catalog(), default_client()
    book = load_book(args.book)
    result = {"book": args.book.name}
    if args.task in ("beats", "all"):
        result["beats"] = evaluate_beats(book, catalog, client)
    if args.task in ("staging", "all"):
        result["staging"] = evaluate_staging(book, catalog, client, [int(n) for n in args.chapters.split(",")], args.book.parent)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
