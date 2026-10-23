"""The event chain: a chapter reduced to its important events, in order.

Each paragraph is a candidate event. Candidates are scored by rules (who is
involved, what happens, how tense it is, how central its words are) and the
best are kept. The result is a chain: every event has exactly one child, the
next important event. Only the chain is shown in the game.
"""

import math
import re
from dataclasses import dataclass, field

from . import lexicon as L
from .analyze import Analysis, Line

MIN_EVENTS = 4
MAX_EVENTS = 14
SHARE = 0.5  # at most this fraction of paragraphs survives (and never more than MAX_EVENTS)
SHORT_CHAPTER = 12  # paragraphs; a chapter this short keeps more of itself
SHORT_SHARE = 0.7
MAX_SAY_PER_EVENT = 2

WORD_RE = re.compile(r"[a-z']+")


@dataclass
class EventNode:
    id: str
    para: int
    location: str
    summary: str  # the sentence that best tells what happens
    characters: list[str]
    score: float
    reasons: list[str]
    lines: list[Line] = field(default_factory=list)  # what the game shows for this event
    next: str | None = None
    choice: bool = False


def _stopwords() -> set[str]:
    from spacy.lang.en.stop_words import STOP_WORDS

    return set(STOP_WORDS)


def textrank(texts: list[str], iterations: int = 30, damping: float = 0.85) -> list[float]:
    """Classic TextRank: texts that share words with many others are central.
    Similarity is word overlap normalised by length (Mihalcea & Tarau 2004)."""
    stop = _stopwords()
    words = [{w for w in WORD_RE.findall(t.lower()) if w not in stop and len(w) > 2} for t in texts]
    n = len(texts)
    if n == 0:
        return []
    sim = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if len(words[i]) > 1 and len(words[j]) > 1:
                overlap = len(words[i] & words[j])
                if overlap:
                    sim[i][j] = sim[j][i] = overlap / (math.log(len(words[i])) + math.log(len(words[j])))
    out_weight = [sum(row) or 1.0 for row in sim]
    score = [1.0] * n
    for _ in range(iterations):
        score = [(1 - damping) + damping * sum(sim[j][i] / out_weight[j] * score[j] for j in range(n) if sim[j][i]) for i in range(n)]
    top = max(score) or 1.0
    return [s / top for s in score]


def _paragraph_lines(a: Analysis) -> dict[int, list[Line]]:
    out: dict[int, list[Line]] = {}
    for ln in a.lines:
        out.setdefault(ln.para, []).append(ln)
    return out


def _who(lines: list[Line], a: Analysis) -> list[str]:
    seen: list[str] = []
    for ln in lines:
        for cid in [ln.speaker, *[e.actor for e in ln.events], *[e.target for e in ln.events]]:
            if cid in a.characters and cid not in seen:
                seen.append(cid)
        if ln.kind == "narrate":
            for cid, c in a.characters.items():
                if cid not in seen and re.search(rf"\b{re.escape(c.name.split()[-1])}\b", ln.text, re.IGNORECASE):
                    seen.append(cid)
    return seen


MINOR: set[str] = set()  # minor action ids, set from the catalog by build_chain


def story_actions(lines: list[Line]) -> list:
    """Actions that move the story (minor everyday ones left out)."""
    return [e for ln in lines for e in ln.events if (e.kind == "action" and e.action not in MINOR) or e.kind in ("act", "spell")]


def score_paragraph(lines: list[Line], a: Analysis, centrality: float, first_seen: set[str], opens_scene: bool, position: float, prev_danger: int = 0) -> tuple[float, list[str]]:
    """Importance of one paragraph, with the reasons (kept for the debug file)."""
    score = 0.0
    why: list[str] = []
    hero = a.protagonist
    people = _who(lines, a)
    actions = story_actions(lines)
    if hero in people:
        score += 1.5
        why.append("hero")
    if actions:
        score += min(3, len(actions)) * 0.8
        why.append(f"{len(actions)} action(s)")
    # Magic and monsters turn plots.
    if any(e.kind == "spell" for e in actions):
        score += 2.5
        why.append("spell")
    if any(a.characters[e.actor].kind != "human" for e in actions if e.actor in a.characters):
        score += 1.2
        why.append("creature acts")
    # One character doing something to another is what scenes are made of.
    between = [e for e in actions if e.kind == "action" and e.target]
    if between:
        score += min(2, len(between)) * 1.0
        why.append("interaction")
    decisive = [e for e in actions if e.verb in L.DECISIVE_VERBS and e.actor == hero]
    if decisive:
        score += 1.5
        why.append("hero decides")
    danger = max((ln.danger for ln in lines), default=0)
    if danger:
        score += min(4, danger) * 0.8
        why.append(f"tension {danger}")
    if danger - prev_danger >= 2:
        # Tension jumping after a quiet moment is a turn in the plot.
        score += 1.5
        why.append("turning point")
    charged = [ln for ln in lines if ln.kind == "say" and ln.text.rstrip().endswith(("!", "?"))]
    if charged:
        score += min(2, len(charged)) * 0.5
        why.append("charged dialogue")
    newcomers = [p for p in people if p not in first_seen]
    if newcomers:
        score += 1.5
        why.append("introduces " + ", ".join(newcomers))
    sounds = any(e.kind == "sound" for ln in lines for e in ln.events)
    if sounds:
        # A scream or a crash is something happening, even with nobody named.
        score += 1.6
        why.append("sound")
    if opens_scene:
        score += 2.5
        why.append("opens a scene")
    if position > 0.8:
        score += 1.0
        why.append("climax")
    score += 2.0 * centrality
    why.append(f"centrality {centrality:.2f}")
    # Pure scenery with nobody in it and nothing heard rarely moves the story.
    if not people and not actions and not sounds and danger < 2:
        score -= 1.5
    return score, why


def _summary(lines: list[Line], names: list[str]) -> str:
    narr = [ln for ln in lines if ln.kind == "narrate"]
    if not narr:
        return lines[0].text if lines else ""
    # Prefer the sentence where someone does something, then one that names
    # people, then one of a readable length.
    def rank(ln: Line):
        acts = len([e for e in ln.events if e.kind != "sound"])
        named = sum(1 for n in names if re.search(rf"\b{re.escape(n)}\b", ln.text))
        return (acts > 0, named, acts, -abs(len(ln.text) - 90))

    return max(narr, key=rank).text


def _shown_lines(lines: list[Line], hero: str | None, must_keep: set[int], names: list[str]) -> list[Line]:
    """What the game shows for an event: one story beat. The line with the
    event's main action (or, without one, its key sentence), an entrance if
    someone arrives, and at most two lines of dialogue."""
    keep: list[Line] = []
    narr = [ln for ln in lines if ln.kind == "narrate"]
    summary = _summary(lines, names)
    acting = [ln for ln in narr if story_actions([ln])]
    main = max(acting, key=lambda ln: _main_weight(ln)) if acting else next((ln for ln in narr if ln.text == summary), None)
    for ln in narr:
        if ln is main or id(ln) in must_keep or any(e.kind == "move" for e in ln.events):
            keep.append(ln)
    says = [ln for ln in lines if ln.kind == "say"]
    ranked = sorted(says, key=lambda ln: (ln.speaker == hero, ln.text.endswith(("!", "?")), bool(ln.events), len(ln.text)), reverse=True)
    keep += ranked[:MAX_SAY_PER_EVENT]
    keep += [ln for ln in says if id(ln) in must_keep and ln not in keep]
    if not keep:
        return lines[:1]
    kept = {id(ln) for ln in keep}
    return [ln for ln in lines if id(ln) in kept]


def _main_weight(ln: Line) -> int:
    """How much a line's actions matter: one character acting on another
    beats acting on a thing, which beats acting alone."""
    best = 0
    for e in story_actions([ln]):
        best = max(best, 3 if e.target else 2 if e.obj else 1)
    return best


def build_chain(a: Analysis, scenes, moments, catalog=None) -> list[EventNode]:
    """Picks the important paragraphs and links them into a chain."""
    if catalog is not None:
        MINOR.clear()
        MINOR.update(x["id"] for x in catalog["actions"] if x.get("minor"))
    by_para = _paragraph_lines(a)
    paras = sorted(by_para)
    if not paras:
        return []
    texts = [" ".join(ln.text for ln in by_para[p]) for p in paras]
    central = dict(zip(paras, textrank(texts)))
    loc_of = {ln.para: sc.location for sc in scenes for ln in sc.lines}
    scene_openers = {sc.lines[0].para for sc in scenes if sc.lines}
    moment_lines = {id(a.lines[m.line]) for m in moments}
    moment_paras = {a.lines[m.line].para for m in moments}
    # A choice's paragraph and the one before it (the setup) are always kept.
    setup_paras = {paras[max(0, paras.index(p) - 1)] for p in moment_paras}

    seen: set[str] = set()
    scored = []
    prev_danger = 0
    for i, p in enumerate(paras):
        s, why = score_paragraph(by_para[p], a, central[p], seen, p in scene_openers, i / max(1, len(paras) - 1), prev_danger)
        prev_danger = max((ln.danger for ln in by_para[p]), default=0)
        seen.update(_who(by_para[p], a))
        scored.append((p, s, why))

    # Causes count: what leads straight into a choice or a turn in the plot
    # ("a scream from behind the door", "Ron raised his wand").
    for i, (p, s, why) in enumerate(scored):
        ahead = scored[i + 1 : i + 3]
        if any(q in moment_paras for q, _, _ in ahead) or (ahead and "turning point" in ahead[0][2]):
            scored[i] = (p, s + 1.0, [*why, "leads to a turn"])

    share = SHORT_SHARE if len(paras) <= SHORT_CHAPTER else SHARE
    k = max(MIN_EVENTS, min(MAX_EVENTS, math.ceil(len(paras) * share)))
    # Choices, their setup and the ending always stay; scene openings stay
    # while there is room (best first), so the cap holds even in long chapters.
    forced = moment_paras | setup_paras | {paras[-1]}
    score_of = {p: s for p, s, _ in scored}
    for p in sorted(scene_openers, key=lambda q: -score_of.get(q, 0)):
        if len(forced) < MAX_EVENTS:
            forced.add(p)
    chosen = set(forced)
    for p, s, _ in sorted(scored, key=lambda x: -x[1]):
        if len(chosen) >= min(MAX_EVENTS, max(k, len(forced))):
            break
        chosen.add(p)

    names = [c.name.split()[-1] for c in a.characters.values()]
    nodes: list[EventNode] = []
    for p, s, why in scored:
        if p not in chosen:
            continue
        lines = by_para[p]
        if p in forced and p not in scene_openers and p != paras[-1]:
            why = [*why, "choice" if p in moment_paras else "sets up a choice"]
        nodes.append(
            EventNode(
                id=f"e{len(nodes) + 1}",
                para=p,
                location=loc_of.get(p, ""),
                summary=_summary(lines, names),
                characters=_who(lines, a),
                score=round(s, 2),
                reasons=why,
                # A choice point keeps its full paragraph so the hero's action stays.
                lines=list(lines) if p in moment_paras else _shown_lines(lines, a.protagonist, moment_lines, names),
                choice=p in moment_paras,
            )
        )
    for a_node, b_node in zip(nodes, nodes[1:]):
        a_node.next = b_node.id
    return nodes
