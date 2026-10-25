"""Novel -> playable story.

  python -m pipeline build book.pdf --chapter 10 --out web/public/generated
  python -m pipeline build chapter.txt --debug out/debug

Writes one <story-id>.story.json per chapter and, with --validate, checks it
with the engine's own validator (needs Node in web/).
"""

import argparse
import dataclasses
import json
import subprocess
import sys
from pathlib import Path

from .analyze import analyze, hero_score
from .build import build_story
from .text import load_chapters

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "web" / "catalog.json"


def load_catalog(path: Path = CATALOG) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_chapter(chapter, catalog, source: str, hero: str | None = None, analysis=None):
    a = analysis or analyze(chapter.paragraphs, catalog)
    if hero and hero in a.characters:
        a.protagonist = hero
    story, scenes, moments, chain = build_story(chapter.paragraphs, a, catalog, chapter.title, source)
    return story, a, scenes, moments, chain


def chain_json(chain) -> list[dict]:
    """The event chain as data: each event names the next one."""
    return [
        {"id": n.id, "next": n.next, "location": n.location, "summary": n.summary, "characters": n.characters, "choice": n.choice, "score": n.score, "why": n.reasons}
        for n in chain
    ]


def book_hero(analyses) -> str | None:
    """The character the whole book follows: most mentions across all chapters.
    A chapter where someone else talks more still keeps the same hero."""
    totals: dict[str, float] = {}
    for a in analyses:
        for c in a.characters.values():
            if c.kind == "human":
                totals[c.id] = totals.get(c.id, 0) + hero_score(c)
    return max(totals, key=totals.get) if totals else None


def build_book(chapters, catalog, source: str):
    """Analyses every chapter once, picks the hero from all of them, then builds."""
    analyses = [analyze(ch.paragraphs, catalog) for ch in chapters]
    hero = book_hero(analyses)
    return [build_chapter(ch, catalog, source, hero, a) for ch, a in zip(chapters, analyses)]


def validate(path: Path) -> bool:
    r = subprocess.run(
        ["npx", "vite-node", "scripts/validate-story.ts", str(path.resolve())],
        cwd=ROOT / "web",
        capture_output=True,
        text=True,
    )
    sys.stdout.write(r.stdout[-2000:])
    return r.returncode == 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="turn a novel into story files")
    b.add_argument("source", type=Path)
    b.add_argument("--chapter", type=int, help="1-based chapter number (default: all)")
    b.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "generated")
    b.add_argument("--debug", type=Path, help="also write each step's output here")
    b.add_argument("--validate", action="store_true")
    inv = sub.add_parser("inventory", help="report which assets a novel needs that the manifest lacks")
    inv.add_argument("source", type=Path)
    inv.add_argument("--top", type=int, default=60)
    inv.add_argument("--json", type=Path, help="also write the full report as JSON")
    args = p.parse_args(argv)

    if args.cmd == "inventory":
        from .inventory import inventory, report

        data = inventory(load_chapters(args.source), load_catalog())
        print(report(data, args.top))
        if args.json:
            args.json.write_text(json.dumps(data, indent=2))
        return 0

    catalog = load_catalog()
    chapters = load_chapters(args.source)
    if not chapters:
        print("no chapters found", file=sys.stderr)
        return 1
    picked = [chapters[args.chapter - 1]] if args.chapter else chapters
    source = args.source.stem.replace("_", " ").replace("-", " ").title()
    args.out.mkdir(parents=True, exist_ok=True)
    ok = True
    # The hero is decided from the whole book, even when building one chapter.
    analyses = {id(ch): analyze(ch.paragraphs, catalog) for ch in chapters}
    hero = book_hero(analyses.values())
    from .assetgen import add_looks

    add_looks(chapters, list(analyses.values()), args.out / "looks.json")
    for ch in picked:
        story, a, scenes, moments, chain = build_chapter(ch, catalog, source, hero, analyses[id(ch)])
        path = args.out / f"{story['id']}.story.json"
        path.write_text(json.dumps(story, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        total = len({ln.para for ln in a.lines})
        print(f"{path}: {len(chain)} of {total} paragraphs kept as events, {len(moments)} choices, hero {a.protagonist}")
        for m in moments:
            print(f"  choice: [{m.correct}] vs [{m.opposite}]")
        if args.debug:
            d = args.debug / story["id"]
            d.mkdir(parents=True, exist_ok=True)
            dump = lambda o: json.dumps(o, indent=2, ensure_ascii=False, default=lambda x: sorted(x) if isinstance(x, set) else str(x))
            (d / "1-characters.json").write_text(dump({k: dataclasses.asdict(c) for k, c in a.characters.items()}))
            (d / "2-lines.json").write_text(dump([dataclasses.asdict(ln) for ln in a.lines]))
            (d / "3-scenes.json").write_text(dump([{"location": s.location, "lines": [ln.text for ln in s.lines]} for s in scenes]))
            (d / "4-moments.json").write_text(dump([dataclasses.asdict(m) for m in moments]))
            (d / "5-event-chain.json").write_text(dump(chain_json(chain)))
        if args.validate:
            ok = validate(path) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
