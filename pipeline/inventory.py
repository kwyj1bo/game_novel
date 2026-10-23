"""Asset coverage report: what a book needs versus what the manifest has.

Lists every character (with mentions and whether a manifest character covers
them) and every verb characters perform (with counts and whether an action
asset covers it). Use it to see which assets a book is missing.
"""

from collections import Counter

from . import lexicon as L
from .analyze import analyze

# Verbs about thinking, feeling or being: real, but nothing to animate.
INVISIBLE_VERBS = {
    "be", "have", "do", "know", "think", "feel", "seem", "want", "need", "like", "love", "hate", "hope",
    "wish", "remember", "forget", "believe", "mean", "understand", "realize", "realise", "wonder", "notice",
    "see", "hear", "find", "get", "make", "let", "try", "begin", "start", "keep", "manage", "decide",
    "suppose", "expect", "guess", "imagine", "learn", "say", "tell", "ask", "become", "happen", "seem",
    "appear", "sound", "look", "can", "could", "will", "would", "should", "must", "may", "might", "go",
    "come", "use", "put", "set", "give", "take", "lose", "win", "allow", "mind", "care", "dare", "bother",
}


def inventory(chapters, catalog) -> dict:
    """Characters and performed verbs across a book, against the manifest."""
    actions = {a["id"]: a for a in catalog["actions"]}
    verb_to_action = {v: a["id"] for a in catalog["actions"] for v in a["verbs"]}
    for a in catalog["actions"]:
        for v in a.get("with", {}):
            verb_to_action.setdefault(v, a["id"])
    people: dict[str, dict] = {}
    verbs: Counter[str] = Counter()
    verb_examples: dict[str, set[str]] = {}
    for ch in chapters:
        a = analyze(ch.paragraphs, catalog)
        for c in a.characters.values():
            p = people.setdefault(c.id, {"name": c.name, "kind": c.kind, "mentions": 0, "chapters": 0, "asset": c.asset, "gender": c.gender})
            p["mentions"] += c.mentions
            p["chapters"] += 1
            if p["gender"] == "x":
                p["gender"] = c.gender
        # Every verb whose subject is a character, mapped or not.
        from .analyze import nlp

        for para in ch.paragraphs:
            for tok in nlp()(para):
                if tok.pos_ != "VERB":
                    continue
                subj = next((c for c in tok.children if c.dep_ == "nsubj"), None)
                if subj is None:
                    continue
                if subj.pos_ != "PROPN" and subj.lower_ not in ("he", "she", "they"):
                    continue
                lem = tok.lemma_.lower()
                if lem in L.SPEECH_VERBS:
                    continue
                verbs[lem] += 1
                if subj.pos_ == "PROPN":
                    verb_examples.setdefault(lem, set()).add(subj.text)
    covered = {v: verb_to_action.get(v) for v in verbs}
    return {
        "characters": sorted(people.values(), key=lambda p: -p["mentions"]),
        "verbs": [
            {"verb": v, "count": n, "action": covered[v], "visible": v not in INVISIBLE_VERBS}
            for v, n in verbs.most_common()
        ],
        "known_actions": len(actions),
    }


def report(inv: dict, top: int = 60) -> str:
    out = []
    chars = inv["characters"]
    missing = [c for c in chars if c["kind"] == "human" and not c["asset"]]
    out.append(f"Characters: {len(chars)} found, {len(chars) - len(missing)} have an asset, {len(missing)} use a generated look")
    for c in missing[:top]:
        out.append(f"  missing  {c['name']:<22} mentions {c['mentions']:>6.1f}  chapters {c['chapters']:>2}  gender {c['gender']}")
    vis = [v for v in inv["verbs"] if v["visible"]]
    unmapped = [v for v in vis if not v["action"]]
    total = sum(v["count"] for v in vis)
    mapped = sum(v["count"] for v in vis if v["action"])
    out.append(f"Visible verbs: {len(vis)} kinds, {mapped}/{total} uses covered by an action asset ({100 * mapped / max(1, total):.0f}%)")
    for v in unmapped[:top]:
        out.append(f"  unmapped {v['verb']:<16} x{v['count']}")
    return "\n".join(out)
