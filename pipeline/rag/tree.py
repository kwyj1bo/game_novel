"""A PageIndex-style tree of a book, and reasoning-based retrieval over it.

PageIndex (VectifyAI) retrieves without vectors: it builds a table of contents
with a summary on every node, and an LLM reads that tree and decides which
sections to open, the way a person uses an index.

Here the tree is book -> chapter -> scene -> section (a few paragraphs). The
pipeline already finds scenes, their place and their cast, so the tree costs
no model calls. Summaries are extractive (the most central sentences, by
TextRank) rather than written by a model.

Navigation is top-down in two requests: the model first picks scenes from the
chapter and scene outline, then picks sections inside those scenes.
"""

from dataclasses import dataclass, field

SECTION = 6  # paragraphs per leaf section
SUMMARY_CHARS = 220


@dataclass
class Node:
    id: str
    title: str
    summary: str = ""
    chapter: int = -1
    paras: list[int] = field(default_factory=list)
    children: list["Node"] = field(default_factory=list)

    def leaves(self) -> list["Node"]:
        return [self] if not self.children else [x for c in self.children for x in c.leaves()]

    def find(self, node_id: str) -> "Node | None":
        if self.id == node_id:
            return self
        return next((n for c in self.children if (n := c.find(node_id))), None)


class BookTree:
    """The tree and the two-step navigation over it."""

    def __init__(self, root: Node):
        self.root = root

    @classmethod
    def build(cls, chapters, analyses, catalog) -> "BookTree":
        from ..build import segment

        root = Node(id="book", title="Book")
        for c, (ch, a) in enumerate(zip(chapters, analyses)):
            chapter = Node(id=f"c{c + 1}", title=ch.title or ch.heading or f"Chapter {c + 1}", chapter=c)
            for s, sc in enumerate(segment(ch.paragraphs, a.lines, catalog)):
                paras = sorted({ln.para for ln in sc.lines})
                place = catalog["locations"].get(sc.location, {}).get("title", "unknown place")
                cast = _cast(sc.lines, a)
                scene = Node(id=f"{chapter.id}.s{s + 1}", title=f"{place}; with {', '.join(cast) or 'nobody named'}", chapter=c, paras=paras)
                for k in range(0, len(paras), SECTION):
                    part = paras[k : k + SECTION]
                    scene.children.append(Node(id=f"{scene.id}.p{k // SECTION + 1}", title=f"paragraphs {part[0] + 1}-{part[-1] + 1}",
                                               summary=summarize([ch.paragraphs[p] for p in part]), chapter=c, paras=part))
                scene.summary = summarize([ch.paragraphs[p] for p in paras])
                chapter.children.append(scene)
            chapter.paras = [p for s in chapter.children for p in s.paras]
            root.children.append(chapter)
        return cls(root)

    def outline(self, nodes: list[Node], depth: int) -> str:
        """An indented table of contents of these nodes, `depth` levels deep."""
        out: list[str] = []

        def walk(n: Node, level: int):
            out.append(f"{'  ' * level}[{n.id}] {n.title}" + (f": {n.summary}" if n.summary else ""))
            if level + 1 < depth:
                for c in n.children:
                    walk(c, level + 1)

        for n in nodes:
            walk(n, 0)
        return "\n".join(out)

    def navigate(self, ask, questions: list[dict], scenes: int = 3, sections: int = 3) -> dict[str, list[Node]]:
        """Question id -> the leaf sections the model chose for it.
        `ask(system, label, items, schema)` is one structured model request."""
        top = self.outline(self.root.children, depth=2)
        picked = _pick(ask, STEP_ONE, top, questions, scenes)
        out: dict[str, list[Node]] = {}
        second = []
        for q in questions:
            chosen = [n for i in picked.get(q["id"], []) if (n := self.root.find(i)) and n.children and n.id.count(".") == 1]
            if chosen:
                second.append({**q, "outline": self.outline(chosen, depth=2)})
            out[q["id"]] = [leaf for n in chosen for leaf in n.leaves()]
        if second:
            for qid, ids in _pick(ask, STEP_TWO, None, second, sections).items():
                leaves = [n for i in ids if (n := self.root.find(i)) and not n.children]
                if leaves:
                    out[qid] = leaves
        return out


STEP_ONE = (
    "You find passages in a novel using its table of contents. Each line is a node: [id] title: summary. "
    "Chapters contain scenes. For each question, choose the scene ids (like c3.s2) most likely to hold the "
    "answer, best first. Prefer the scene where a person or place is first introduced or described."
)
STEP_TWO = (
    "You find passages in a novel. For each question you get the sections of the scenes chosen before. "
    "Choose the section ids (like c3.s2.p1) most likely to hold the answer, best first."
)


def _pick(ask, system: str, outline: str | None, questions: list[dict], limit: int) -> dict[str, list[str]]:
    schema = {
        "type": "object",
        "properties": {"picks": {"type": "array", "items": {
            "type": "object",
            "properties": {"id": {"type": "string"}, "nodes": {"type": "array", "items": {"type": "string"}}},
            "required": ["id", "nodes"], "additionalProperties": False}}},
        "required": ["picks"], "additionalProperties": False,
    }  # fmt: skip
    items = ([{"table_of_contents": outline}] if outline else []) + [{k: v for k, v in q.items()} for q in questions]
    data = ask(system, f"Questions (choose at most {limit} ids each)", items, schema) or {"picks": []}
    return {p["id"]: p["nodes"][:limit] for p in data["picks"]}


def _cast(lines, a) -> list[str]:
    seen: list[str] = []
    for ln in lines:
        for cid in [ln.speaker, *(e.actor for e in ln.events)]:
            if cid in a.characters and cid not in seen and a.characters[cid].kind == "human":
                seen.append(cid)
    return [a.characters[c].name for c in seen[:5]]


def summarize(paragraphs: list[str], sentences: int = 2) -> str:
    """The most central sentences (TextRank), in reading order."""
    from ..events import textrank
    from .search import SENTENCE

    sents = [s for p in paragraphs for s in SENTENCE.split(p) if len(s) > 25]
    if not sents:
        return ""
    scores = textrank(sents) if len(sents) > 2 else [1.0] * len(sents)
    best = sorted(sorted(range(len(sents)), key=lambda i: -scores[i])[:sentences])
    text = " ".join(sents[i] for i in best)
    return text if len(text) <= SUMMARY_CHARS else text[: SUMMARY_CHARS - 1].rsplit(" ", 1)[0] + "…"
