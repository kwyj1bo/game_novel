"""Evaluation: does the studio adapt a chapter better than the old rules?

LLM-as-judge, pairwise: the judge reads the chapter's index entry and two
adaptations as plain scripts (what the player sees and hears), and says
which is more faithful, more complete on the plot and easier to follow. Each
pair is judged twice with the order swapped; a win counts only when both
orders agree, so position bias cancels out.

Grounding: the share of character designs that cite the book.
"""

import json
from pathlib import Path

from .index import BookIndex
from .llm import S, Model, obj

JUDGE_SYSTEM = (
    "You judge adaptations of a novel chapter into a short game. You get the chapter's summary and scenes, and "
    "two scripts, A and B: what the player sees and hears, in order. Judge which is better on: faithfulness (no "
    "events, people or places that are not in the book), plot (the turning points a reader would expect are "
    "there), and clarity (a player who never read the book could follow it). Answer A, B or tie for each, and "
    "overall."
)
CRITERIA = ("faithfulness", "plot", "clarity", "overall")


def script_of_story(story: dict) -> list[str]:
    """What a player of an engine story sees: narration and dialogue, in scene order."""
    actors = story["actors"]
    lines, sid, seen = [], story["start"], set()
    while sid and sid not in seen:
        seen.add(sid)
        scene = story["scenes"][sid]
        lines.append(f"-- {scene.get('title') or scene['location']}")
        for b in scene["beats"]:
            if "narrate" in b:
                lines.append(b["narrate"])
            elif "say" in b:
                lines.append(f"{actors[b['say']]['name']}: {b['text']}")
        choice = scene.get("choice")
        if choice:
            lines.append(f"[choice] {choice['prompt']} / " + " / ".join(o["label"] for o in choice["options"]))
            sid = next(o["goto"] for o in choice["options"] if o["correct"])
        else:
            sid = scene.get("goto")
    return lines


def judge(model: Model, index: BookIndex, c: int, a: list[str], b: list[str]) -> dict:
    """Both orders; per criterion "first", "second" or "tie" (for script `a` first)."""
    ch = index.chapters[c]
    context = {"summary": ch.summary, "scenes": [f"{s.place}: {s.summary}" for s in ch.scenes]}
    schema = obj({k: S for k in CRITERIA} | {"why": S})
    valid = lambda r: [f"{k} must be A, B or tie" for k in CRITERIA if r[k] not in ("A", "B", "tie")]  # noqa: E731
    ab = model.ask(JUDGE_SYSTEM, f"Judge chapter {c + 1} (order 1)", {**context, "A": a, "B": b}, schema, effort="high", check=valid)
    ba = model.ask(JUDGE_SYSTEM, f"Judge chapter {c + 1} (order 2)", {**context, "A": b, "B": a}, schema, effort="high", check=valid)
    out = {}
    for k in CRITERIA:
        first = {"A": "first", "B": "second", "tie": "tie"}[ab[k]]
        swapped = {"A": "second", "B": "first", "tie": "tie"}[ba[k]]
        out[k] = first if first == swapped else "tie"
    out["why"] = [ab["why"], ba["why"]]
    return out


def compare(model: Model, book: Path, chapters: list[int]) -> dict:
    """Studio stories against the rule-built ones in the library, chapter by chapter."""
    index = BookIndex.load(book / "studio" / "index.json")
    results = {}
    for n in chapters:
        studio = json.loads((book / f"studio-c{n}.story.json").read_text())
        rules = json.loads(next(book.glob(f"{n:02d}-*.story.json")).read_text())
        results[n] = judge(model, index, n - 1, script_of_story(studio), script_of_story(rules))
    wins = {k: sum(r[k] == "first" for r in results.values()) for k in CRITERIA}
    losses = {k: sum(r[k] == "second" for r in results.values()) for k in CRITERIA}
    return {"chapters": results, "studio_wins": wins, "rules_wins": losses, "judged": len(results)}


def grounding(production: dict) -> dict:
    designs = production.get("characters", []) + production.get("places", [])
    cited = sum(bool(d.get("cites")) for d in designs)
    return {"designs": len(designs), "cited": cited, "share": round(cited / len(designs), 3) if designs else None}
