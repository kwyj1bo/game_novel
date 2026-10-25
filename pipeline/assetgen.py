"""AI-made looks for characters the asset library doesn't have.

The story is still found by rules; only the look comes from a model. The
model reads what the book says about each missing character and answers with
an actor spec (hair, robe, height, glasses...), the same data the engine
draws a manifest character from. Looks are asked for once per book, checked,
and cached, so the same book always gives the same game. Without credentials
or with NOVEL_ASSET_AI=0, characters keep their generated looks.
"""

import json
import logging
import os
import re
from pathlib import Path

log = logging.getLogger(__name__)

MODEL = os.environ.get("NOVEL_ASSET_MODEL", "claude-opus-5-5")
MAX_CHARACTERS = 40  # most-mentioned first; the rest keep generated looks
MAX_DESCRIPTIONS = 6

SPEC = json.loads((Path(__file__).resolve().parent.parent / "web" / "story.schema.json").read_text())["properties"]["actors"]["additionalProperties"]["properties"]
# The parts of the engine's actor spec a look sets, with the engine's own enums.
FIELDS = ["height", "robe", "skin", "hair", "hairStyle", "eyes", "glasses", "beard", "outfit", "hat", "scar", "voice"]
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
LOOK_WORDS = re.compile(
    r"\b(hair|eyes?|beard|moustache|mustache|face|tall|short|huge|tiny|thin|skinny|fat|plump|large|small|wore|wearing|robes?|"
    r"cloak|coat|glasses|spectacles|scar|bald|blond|blonde|ginger|red|black|white|grey|gray|silver|brown|pale|old|young|giant)\b",
    re.IGNORECASE,
)
SENTENCE = re.compile(r"(?<=[.!?])\s+")

SYSTEM = (
    "You design characters for a 3D game made from a novel. For each character, read what the book says "
    "and choose a look that matches it. Where the book says nothing, choose something that fits the name, "
    "age and role. Colours are #rrggbb. Height is in metres (children about 1.3, adults 1.6 to 1.9, a giant "
    "up to 3). Students wear the 'student' outfit; everyone else 'adult'. Voice is a pitch multiplier: about "
    "0.85 for deep voices, 1.0 for most adults, 1.35 for children and high voices."
)


def _schema() -> dict:
    look = {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id", *FIELDS], "additionalProperties": False}
    for f in FIELDS:
        look["properties"][f] = {k: v for k, v in SPEC[f].items() if k in ("type", "enum")}
    return {"type": "object", "properties": {"looks": {"type": "array", "items": look}}, "required": ["looks"], "additionalProperties": False}


def descriptions(chapters, c) -> list[str]:
    """Sentences that describe how the character looks: ones that name them,
    and, where they first appear, the few paragraphs before (books often describe
    someone before naming them: "A tall man with a grey beard stood up")."""
    names = {w for w in [c.name, *c.name.split()] if len(w) > 2}
    pattern = re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b")
    paras = [p for ch in chapters for p in ch.paragraphs]
    first = next((i for i, p in enumerate(paras) if pattern.search(p)), None)
    out = []
    for i, para in enumerate(paras):
        intro = first is not None and first - 3 <= i <= first
        for s in SENTENCE.split(para):
            if (intro or pattern.search(s)) and LOOK_WORDS.search(s) and s[:300] not in out:
                out.append(s[:300])
                if len(out) == MAX_DESCRIPTIONS:
                    return out
    return out


def valid(look: dict) -> dict | None:
    """A look the engine can draw, or None."""
    spec = {f: look.get(f) for f in FIELDS}
    for f in ("robe", "skin", "hair", "eyes"):
        if not isinstance(spec[f], str) or not COLOR.match(spec[f]):
            return None
    for f in ("hairStyle", "glasses", "beard", "outfit", "hat"):
        if spec[f] not in SPEC[f]["enum"]:
            return None
    if not isinstance(spec["height"], (int, float)) or not isinstance(spec["voice"], (int, float)) or not isinstance(spec["scar"], bool):
        return None
    spec["height"] = round(min(3.2, max(0.9, spec["height"])), 2)
    spec["voice"] = round(min(1.6, max(0.6, spec["voice"])), 2)
    return spec


def ask(client, people: list[dict]) -> dict[str, dict]:
    """One request for every missing character. Returns id -> checked look."""
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": _schema()}},
        system=SYSTEM,
        messages=[{"role": "user", "content": "Characters:\n" + json.dumps(people, indent=1, ensure_ascii=False)}],
    )
    if response.stop_reason != "end_turn":
        log.warning("asset model stopped early (%s); keeping generated looks", response.stop_reason)
        return {}
    data = json.loads(next(b.text for b in response.content if b.type == "text"))
    return {x["id"]: spec for x in data["looks"] if (spec := valid(x))}


def add_looks(chapters, analyses, cache: Path, client=None) -> int:
    """Gives characters without an asset an AI-made look (cached in `cache`).
    Returns how many characters got one."""
    if os.environ.get("NOVEL_ASSET_AI", "1") == "0":
        return 0
    missing = {}
    for a in analyses:
        for c in a.characters.values():
            if c.kind == "human" and not c.asset and (c.id not in missing or c.mentions > missing[c.id].mentions):
                missing[c.id] = c
    wanted = sorted(missing.values(), key=lambda c: -c.mentions)[:MAX_CHARACTERS]
    looks = json.loads(cache.read_text()) if cache.exists() else {}
    need = [c for c in wanted if c.id not in looks]
    if need:
        people = [{"id": c.id, "name": c.name, "gender": {"m": "male", "f": "female"}.get(c.gender, "unknown"), "book_says": descriptions(chapters, c)} for c in need]
        try:
            import anthropic

            looks.update(ask(client or anthropic.Anthropic(), people))
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(looks, indent=1, ensure_ascii=False))
        except Exception as e:  # no SDK, no credentials, network or API error
            log.warning("AI looks unavailable (%s); keeping generated looks", e)
    for a in analyses:
        for c in a.characters.values():
            if c.id in looks and not c.asset:
                c.look = looks[c.id]
    return sum(1 for c in wanted if c.id in looks)
