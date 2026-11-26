"""Compare retrieval modes on a book whose assets were made by hand.

    python -m pipeline.rag.evaluate --book library/<harry potter folder> --runs 2

Ground truth is the manifest: hand-made looks for the book's cast and
hand-made sceneries for its places. For each mode the AI step runs with those
assets hidden, on a copy of the book where every name is invented, and its
answers are scored field by field against the hand-made ones.

Modes: none (no book text, the model's guess from a name), keyword (the
original rule), hybrid (BM25 + embeddings) and tree (PageIndex navigation).
"""

import argparse
import colorsys
import json
import statistics
import sys
import time
from pathlib import Path

from .. import assetgen
from ..analyze import analyze
from ..text import Chapter
from .pseudonym import Pseudonyms
from .retrievers import Retriever

WORLD_WORDS = {"Hogwarts", "Gryffindor", "Slytherin", "Hufflepuff", "Ravenclaw", "Quidditch", "Muggle", "Muggles", "Diagon",
               "Gringotts", "Ollivanders", "Privet", "Smeltings", "Grunnings", "Erised", "Flamel", "Nicolas", "Voldemort"}
GENERIC = {"goblin", "witch", "wizard", "guard"}  # manifest extras, not book characters
MIN_MENTIONS = 5
MAX_SCENES = 30
LOOK_FIELDS = ["hair", "glasses", "beard", "hat", "scar", "height", "outfit"]


def load_book(folder: Path) -> list[Chapter]:
    return [Chapter(**json.loads(p.read_text())) for p in sorted(folder.glob("*.text.json"))]


class Evaluation:
    def __init__(self, folder: Path, catalog, client, runs: int):
        self.catalog, self.client, self.runs = catalog, client, runs
        self.real = load_book(folder)
        self.fake_names = Pseudonyms.for_catalog(catalog, WORLD_WORDS)
        self.book = self.fake_names.chapters(self.real)
        # Sceneries and cast made for this book are hidden; generic ones stay.
        self.hidden = _strip_book_assets(catalog)
        manifest = json.loads((assetgen.WEB / "assets" / "manifest.json").read_text())
        self.presets = {s["id"]: s["preset"] for s in manifest["sceneries"] if "preset" in s}
        self.analyses = [analyze(ch.paragraphs, self.hidden) for ch in self.book]

    # ---- looks ------------------------------------------------------------

    def looks(self, modes: list[str]) -> dict:
        cast = self._cast()
        truth = {c.id: self.catalog["characters"][self.real_id[c.id]]["spec"] for c in cast}
        out = {"characters": len(cast), "modes": {}}
        for how in modes:
            scores, raw = [], []
            for _ in range(self.runs):
                says = {c.id: [] for c in cast} if how == "none" else self._retriever(how).looks(cast)
                people = [{"id": c.id, "name": c.name, "gender": "unknown", "book_says": says[c.id]} for c in cast]
                answer = assetgen.ask(self.client, people)
                scores.append(score_looks(answer, truth))
                raw.append({"book_says": says, "answer": answer})
            out["modes"][how] = {**summarize_runs(scores), "raw": raw}
            print(f"looks {how}: {out['modes'][how]['accuracy']}", file=sys.stderr)
        return out

    def _cast(self):
        """The book's cast under opaque ids (p1, p2...): a real id such as
        "dumbledore" next to an invented name would give the answer away."""
        cast = []
        self.real_id: dict[str, str] = {}
        for cid, c in self.catalog["characters"].items():
            if c["spec"].get("kind", "human") != "human" or cid in GENERIC:
                continue
            ch = self.fake_names.character(f"p{len(self.real_id) + 1}", c["names"])
            self.real_id[ch.id] = cid
            from .retrievers import name_pattern

            pattern = name_pattern(ch)
            if sum(len(pattern.findall(p)) for chap in self.book for p in chap.paragraphs) >= MIN_MENTIONS:
                cast.append(ch)
        return cast

    # ---- places -----------------------------------------------------------

    def places(self, modes: list[str]) -> dict:
        scenes, truth = self._scenes()
        out = {"scenes": len(scenes), "modes": {}}
        for how in modes:
            scores, raw = [], []
            for _ in range(self.runs):
                texts = {s["key"]: "" for s in scenes} if how == "none" else self._retriever(how).places(scenes)
                need = [{"key": s["key"], "chapter": s["title"], "scene": texts[s["key"]]} for s in scenes]
                data = assetgen.request(self.client, assetgen.PLACE_SYSTEM, "Library places and scenes", [{"library": []}, *need], assetgen._place_schema())
                scores.append(score_places(data or {"places": []}, truth))
                raw.append({"scene_text": texts, "answer": data})
            out["modes"][how] = {**summarize_runs(scores), "raw": raw}
            print(f"places {how}: {out['modes'][how]['accuracy']}", file=sys.stderr)
        return out

    def _scenes(self):
        """Scenes the full manifest places in one of this book's sceneries,
        spread evenly over the book."""
        from ..build import segment

        found = []
        for c, (real, fake) in enumerate(zip(self.real, self.book)):
            a = analyze(real.paragraphs, self.catalog)
            for i, sc in enumerate(segment(real.paragraphs, a.lines, self.catalog)):
                preset = self.presets.get(sc.location)
                if preset and sc.location not in self.hidden["locations"]:
                    paras = sorted({ln.para for ln in sc.lines})
                    found.append(({"key": f"c{c + 1}s{i + 1}", "chapter": c, "title": fake.title, "paras": paras,
                                   "start": " ".join(fake.paragraphs[p] for p in paras[:3])[:900]}, preset))
        step = max(1, len(found) / MAX_SCENES)
        picked = [found[int(i * step)] for i in range(min(MAX_SCENES, len(found)))]
        return [s for s, _ in picked], {s["key"]: p for s, p in picked}

    def _retriever(self, how: str) -> Retriever:
        return Retriever(self.book, self.analyses, how, ask=assetgen.asker(self.client), catalog=self.hidden)


# ---- scoring ------------------------------------------------------------------


def hair_colour(hex_colour: str) -> str:
    r, g, b = (int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if v < 0.22:
        return "black"
    if s < 0.25:
        return "grey"
    if (h < 25 / 360 or h > 340 / 360) and s > 0.45:
        return "red"
    return "blond" if h < 55 / 360 and v >= 0.6 else "brown"


def look_fields(spec: dict) -> dict:
    height = spec.get("height", 1.7)
    return {
        "hair": hair_colour(spec.get("hair", "#000000")),
        "glasses": spec.get("glasses", "none") != "none",
        "beard": spec.get("beard", "none") != "none",
        "hat": spec.get("hat", "none") != "none",
        "scar": bool(spec.get("scar", False)),
        "height": "child" if height < 1.6 else "giant" if height > 2.2 else "adult",
        "outfit": spec.get("outfit", "adult"),
    }


FEATURES = ["glasses", "beard", "hat", "scar"]


def score_looks(answer: dict[str, dict], truth: dict[str, dict]) -> dict:
    """Most of the cast has no glasses, beard, hat or scar, so a model that
    always says "none" gets most fields right. The score is therefore the mean
    of four parts that a default cannot win: hair colour (five colours),
    distinctive features (F1 over glasses, beard, hat and scar), height
    (child, adult or giant) and outfit (student or adult)."""
    n = len(truth) or 1
    hits = {"hair": 0, "height": 0, "outfit": 0}
    tp = fp = fn = 0
    for cid, spec in truth.items():
        want = look_fields(spec)
        got = look_fields(answer[cid]) if cid in answer else None
        for f in hits:
            hits[f] += bool(got) and got[f] == want[f]
        for f in FEATURES:
            g, w = bool(got and got[f]), want[f]
            tp, fp, fn = tp + (g and w), fp + (g and not w), fn + (w and not g)
    f1 = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 1.0
    fields = {"hair": hits["hair"] / n, "features_f1": f1, "height": hits["height"] / n, "outfit": hits["outfit"] / n}
    return {"accuracy": sum(fields.values()) / len(fields), "fields": fields, "features": {"found": tp, "invented": fp, "missed": fn}, "answered": len(answer)}


def score_places(data: dict, truth: dict[str, dict]) -> dict:
    got = {p.get("key"): p for p in data.get("places", [])}
    type_ok = sum(got.get(k, {}).get("type") == t["type"] for k, t in truth.items())
    time_ok = sum(got.get(k, {}).get("time") == t.get("time") for k, t in truth.items())
    n = len(truth) or 1
    return {"accuracy": type_ok / n, "fields": {"type": type_ok / n, "time": time_ok / n}, "answered": len(got)}


def summarize_runs(scores: list[dict]) -> dict:
    accs = [s["accuracy"] for s in scores]
    fields = {f: round(statistics.mean(s["fields"][f] for s in scores), 3) for f in scores[0]["fields"]}
    out = {"accuracy": round(statistics.mean(accs), 3), "runs": [round(a, 3) for a in accs], "fields": fields}
    if "features" in scores[0]:
        out["features"] = [s["features"] for s in scores]
    return out


def _strip_book_assets(catalog) -> dict:
    """The catalog without this book's hand-made cast and named sceneries."""
    keep = {k: v for k, v in catalog["locations"].items() if k.startswith("generic_")}
    return {**catalog, "locations": keep, "characters": {k: v for k, v in catalog["characters"].items() if k in GENERIC}}


def main(argv=None) -> int:
    from ..__main__ import load_catalog

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--book", type=Path, required=True)
    ap.add_argument("--task", choices=["looks", "places", "all"], default="all")
    ap.add_argument("--modes", default="none,keyword,hybrid,tree")
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--json", type=Path, default=Path("docs/retrieval.json"))
    args = ap.parse_args(argv)
    catalog = load_catalog()
    started = time.time()
    ev = Evaluation(args.book, catalog, assetgen.default_client(), args.runs)
    modes = args.modes.split(",")
    result = {"book": args.book.name, "runs": args.runs, "model_path": type(ev.client).__name__}
    if args.task in ("looks", "all"):
        result["looks"] = ev.looks(modes)
    if args.task in ("places", "all"):
        result["places"] = ev.places(modes)
    result["minutes"] = round((time.time() - started) / 60, 1)
    # Raw answers quote the book, so they go to a separate file that git ignores.
    raw = {t: {m: v.pop("raw") for m, v in result[t]["modes"].items()} for t in ("looks", "places") if t in result}
    args.json.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(args.json.read_text()) if args.json.exists() else {}
    args.json.write_text(json.dumps({**old, **result}, indent=1) + "\n")
    args.json.with_suffix(".raw.json").write_text(json.dumps(raw, indent=1, ensure_ascii=False))
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
