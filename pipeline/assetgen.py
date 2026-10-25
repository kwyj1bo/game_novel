"""AI-made assets for what the asset library doesn't have.

The story is still found by rules; only the assets come from a model.

- Looks: the model reads what the book says about each missing character and
  answers with an actor spec (hair, robe, height, glasses...), the same data
  the engine draws a manifest character from.
- Places: for a scene no manifest keyword places, the model reads the scene
  and answers with a preset (type, time of day, colours, props), which the
  engine builds in 3D like a manifest scenery.

Generated assets go into one shared library (a folder of JSON files) that
every later book, and every user of the same server, reuses: a character is
asked for only if the library has no look for that name, and a scene is
matched to an existing generated place before a new one is designed. So the
same book always gives the same game, and each new book needs fewer requests.

The model is reached through an API key (ANTHROPIC_API_KEY) or, without one,
through Claude Code on this computer, which uses the Claude subscription it is
signed in with. Without either, or with NOVEL_ASSET_AI=0, characters keep their
generated looks and scenes the default scenery.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

MODEL = os.environ.get("NOVEL_ASSET_MODEL", "claude-opus-5-5")
MAX_CHARACTERS = 40  # most-mentioned first; the rest keep generated looks
MAX_DESCRIPTIONS = 6

MAX_PLACES = 30
WEB = Path(__file__).resolve().parent.parent / "web"
PRESET = json.loads((WEB / "assets" / "manifest.schema.json").read_text())["properties"]["sceneries"]["items"]["properties"]["preset"]["properties"]
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


def claude_code() -> str | None:
    """A Claude Code executable: NOVEL_CLAUDE_BIN, `claude` on the PATH, or the
    one inside the VS Code extension."""
    if os.environ.get("NOVEL_CLAUDE_BIN"):
        return os.environ["NOVEL_CLAUDE_BIN"]
    if found := shutil.which("claude"):
        return found
    bundled = list(Path.home().glob(".vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude"))
    return str(max(bundled, key=os.path.getmtime)) if bundled else None


class ClaudeCode:
    """Asks Claude Code instead of the API, so requests use the Claude
    subscription it is signed in with. No tools, no MCP servers, no session."""

    def __init__(self, path: str):
        self.path = path

    def request(self, system: str, prompt: str, schema: dict) -> dict | None:
        args = [self.path, "-p", "--output-format", "json", "--json-schema", json.dumps(schema), "--system-prompt", system,
                "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands", "--effort", "low"]
        with tempfile.TemporaryDirectory() as cwd:
            r = subprocess.run(args, input=prompt, capture_output=True, text=True, timeout=900, cwd=cwd)
        out = json.loads(r.stdout or "{}")
        if out.get("is_error") or r.returncode:
            raise RuntimeError(f"Claude Code: {out.get('result') or r.stderr.strip()[-300:]}")
        return out.get("structured_output")


def default_client():
    """The API with a key, else Claude Code, else the API (an `ant` sign-in)."""
    import anthropic

    if not os.environ.get("ANTHROPIC_API_KEY") and (path := claude_code()):
        return ClaudeCode(path)
    return anthropic.Anthropic()


def request(client, system: str, label: str, items: list[dict], schema: dict) -> dict | None:
    """One structured request; the parsed JSON, or None if the model stopped early."""
    if isinstance(client, ClaudeCode):
        return client.request(system, f"{label}:\n" + json.dumps(items, indent=1, ensure_ascii=False), schema)
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        system=system,
        messages=[{"role": "user", "content": f"{label}:\n" + json.dumps(items, indent=1, ensure_ascii=False)}],
    )
    if response.stop_reason != "end_turn":
        log.warning("asset model stopped early (%s)", response.stop_reason)
        return None
    return json.loads(next(b.text for b in response.content if b.type == "text"))


def ask(client, people: list[dict]) -> dict[str, dict]:
    """One request for every missing character. Returns id -> checked look."""
    data = request(client, SYSTEM, "Characters", people, _schema())
    return {x["id"]: spec for x in (data or {"looks": []})["looks"] if (spec := valid(x))}


def _load(path: Path, empty):
    return json.loads(path.read_text()) if path.exists() else empty


def _save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False))


def add_looks(chapters, analyses, library: Path, client=None) -> int:
    """Gives characters without an asset an AI-made look. Looks are kept in the
    shared library (`library/looks.json`, by character id), so a name already
    seen in any book is not asked for again. Returns how many got one."""
    if os.environ.get("NOVEL_ASSET_AI", "1") == "0":
        return 0
    missing = {}
    for a in analyses:
        for c in a.characters.values():
            if c.kind == "human" and not c.asset and (c.id not in missing or c.mentions > missing[c.id].mentions):
                missing[c.id] = c
    wanted = sorted(missing.values(), key=lambda c: -c.mentions)[:MAX_CHARACTERS]
    looks = _load(library / "looks.json", {})
    need = [c for c in wanted if c.id not in looks]
    if need:
        people = [{"id": c.id, "name": c.name, "gender": {"m": "male", "f": "female"}.get(c.gender, "unknown"), "book_says": descriptions(chapters, c)} for c in need]
        try:
            asked = {c.id for c in need}
            looks.update({cid: look for cid, look in ask(client or default_client(), people).items() if cid in asked})
            _save(library / "looks.json", looks)
        except Exception as e:  # no SDK, no credentials, network or API error
            log.warning("AI looks unavailable (%s); keeping generated looks", e)
    for a in analyses:
        for c in a.characters.values():
            if c.id in looks and not c.asset:
                c.look = looks[c.id]
    return sum(1 for c in wanted if c.id in looks)


# ---- places ------------------------------------------------------------------

PLACE_SYSTEM = (
    "You design places for a 3D game made from novels. Each scene below happens somewhere the game has no "
    "place for. If one of the library places fits the scene well, answer with its id in 'reuse' and fill the "
    "other fields with anything. Otherwise leave 'reuse' empty and describe a new place: the closest type, "
    "the time of day, a wall colour (#rrggbb), a floor material and up to 6 kinds of props. When several "
    "scenes happen in the same new place, give them the same title and the same design."
)
MAX_LIBRARY_HINTS = 80  # library places shown to the model for reuse


def _place_schema() -> dict:
    prop = {"type": "object", "properties": {"kind": {"type": "string", "enum": PRESET["props"]["items"]["properties"]["kind"]["enum"]}, "count": {"type": "integer"}}, "required": ["kind", "count"], "additionalProperties": False}
    place = {
        "type": "object",
        "properties": {
            "key": {"type": "string"},
            "reuse": {"type": "string"},
            "title": {"type": "string"},
            "type": {"type": "string", "enum": PRESET["type"]["enum"]},
            "time": {"type": "string", "enum": PRESET["time"]["enum"]},
            "wall": {"type": "string"},
            "floor": {"type": "string", "enum": PRESET["floor"]["anyOf"][0]["enum"]},
            "props": {"type": "array", "items": prop},
        },
        "required": ["key", "reuse", "title", "type", "time", "wall", "floor", "props"],
        "additionalProperties": False,
    }
    return {"type": "object", "properties": {"places": {"type": "array", "items": place}}, "required": ["places"], "additionalProperties": False}


def valid_place(p: dict) -> dict | None:
    """A place the engine can build, or None."""
    if p.get("type") not in PRESET["type"]["enum"] or p.get("time") not in PRESET["time"]["enum"] or not str(p.get("title", "")).strip():
        return None
    kinds = PRESET["props"]["items"]["properties"]["kind"]["enum"]
    props = [{"kind": x["kind"], "count": min(6, max(1, int(x.get("count", 1))))} for x in p.get("props", []) if x.get("kind") in kinds][:6]
    preset = {"type": p["type"], "time": p["time"], "props": props}
    if isinstance(p.get("wall"), str) and COLOR.match(p["wall"]):
        preset["wall"] = p["wall"]
    if p.get("floor") in PRESET["floor"]["anyOf"][0]["enum"]:
        preset["floor"] = p["floor"]
    title = p["title"].strip()[:60]
    return {"id": "gen_" + (re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_") or "place"), "title": title, "preset": preset}


def add_places(chapters, analyses, catalog, library: Path, client=None) -> dict[str, dict]:
    """AI-made places for scenes no manifest keyword places. The shared
    library (`library/places.json`) keeps every generated place and which
    scene uses which; the model reuses a library place when one fits.
    Returns scene key -> place, for build_story."""
    if os.environ.get("NOVEL_ASSET_AI", "1") == "0":
        return {}
    from .build import UNPLACED, place_key, segment

    store = _load(library / "places.json", {"places": {}, "scenes": {}})
    need = []
    for ch, a in zip(chapters, analyses):
        for sc in segment(ch.paragraphs, a.lines, catalog):
            key = place_key(sc) if sc.lines else None
            if sc.location == UNPLACED and key and key not in store["scenes"] and len(need) < MAX_PLACES:
                need.append({"key": key, "chapter": ch.title, "scene": " ".join(ln.text for ln in sc.lines[:8])[:900]})
    if need:
        hints = [{"id": pid, "title": p["title"], "type": p["preset"]["type"]} for pid, p in list(store["places"].items())[:MAX_LIBRARY_HINTS]]
        try:
            data = request(client or default_client(), PLACE_SYSTEM, "Library places and scenes", [{"library": hints}, *need], _place_schema())
            asked = {n["key"] for n in need}
            for p in (data or {"places": []})["places"]:
                if p.get("key") not in asked:
                    continue
                if p.get("reuse") in store["places"]:
                    store["scenes"][p["key"]] = p["reuse"]
                elif place := valid_place(p):
                    # Same title, same place: the first design stays.
                    store["places"].setdefault(place["id"], {"title": place["title"], "preset": place["preset"]})
                    store["scenes"][p["key"]] = place["id"]
            _save(library / "places.json", store)
        except Exception as e:  # no SDK, no credentials, network or API error
            log.warning("AI places unavailable (%s); using the default scenery", e)
    return {key: {"id": pid, **store["places"][pid]} for key, pid in store["scenes"].items() if pid in store["places"]}
