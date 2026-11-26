"""Which paragraphs of a chapter the game shows.

The rule pipeline scores paragraphs by surface signals (actions, names,
exclamation marks), so a dramatic-sounding aside can beat a quiet reveal.
Here the model reads the chapter as a table of contents, scenes and the
opening of every paragraph under them (the PageIndex idea: reason over the
document's structure, not over vector similarity), and picks the plot beats.
"""

from ..rag.tree import summarize

SYSTEM = (
    "You adapt a chapter of a novel into a short playable game. You get the chapter as a table of contents: "
    "its scenes, and under each scene its numbered paragraphs (the start of each). Choose the paragraphs a "
    "player must see to follow the plot: what changes the situation, decisions, danger, discoveries and "
    "reveals, the arrival of an important character, and how the chapter ends. Leave out description, small "
    "talk, repetition and anything the player could miss without losing the thread. Give a short reason for each."
)
OPENING = 170  # characters of each paragraph shown in the outline
SCHEMA = {
    "type": "object",
    "properties": {"beats": {"type": "array", "items": {
        "type": "object",
        "properties": {"paragraph": {"type": "integer"}, "why": {"type": "string"}},
        "required": ["paragraph", "why"], "additionalProperties": False}}},
    "required": ["beats"], "additionalProperties": False,
}  # fmt: skip


def outline(paragraphs: list[str], scenes, place_title) -> str:
    """The chapter's table of contents: scenes, then their paragraphs."""
    out = []
    for i, sc in enumerate(scenes):
        paras = sorted({ln.para for ln in sc.lines})
        if not paras:
            continue
        out.append(f"[scene {i + 1}] {place_title(sc.location)}: {summarize([paragraphs[p] for p in paras])}")
        for p in paras:
            text = " ".join(paragraphs[p].split())
            out.append(f"  ({p}) {text[:OPENING]}{'…' if len(text) > OPENING else ''}")
    return "\n".join(out)


def pick(ask, title: str, toc: str, k: int, valid: set[int]) -> dict[int, str]:
    """Paragraph -> reason, at most k, in story order."""
    data = ask(SYSTEM, f"Chapter “{title}”: choose about {k} paragraphs", [{"table_of_contents": toc}], SCHEMA) or {"beats": []}
    out: dict[int, str] = {}
    for b in data["beats"]:
        if b.get("paragraph") in valid and len(out) < k:
            out[b["paragraph"]] = str(b.get("why", ""))[:120]
    return dict(sorted(out.items()))
