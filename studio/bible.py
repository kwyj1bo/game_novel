"""The bibles: what every character, place and object looks like, grounded
in the book.

For each entry the evidence step finds quotes (PageIndex navigation, then
hybrid search), and the model writes the description that becomes the 3D
prompt, citing the quotes it used. A checker rejects citations of quotes it
was not given, so every detail traces back to the text (or is marked as
invented where the book says nothing).
"""

import re
from dataclasses import asdict, dataclass

from .llm import B, N, S, Model, arr, obj
from .rag import Evidence

CHARACTER_SYSTEM = (
    "You are the character designer for a 3D game made from a novel. For each character you get quotes from "
    "the book, each with an id like q3. Describe how the character looks, for a text-to-3D model: body, age, "
    "height, face, hair, clothes, colours, anything they always carry. Follow the quotes; where the book says "
    "nothing, choose what fits their role and say so in `invented`. Cite the quote ids you used. Keep the 3D "
    "prompt under 600 characters, describing one full-body figure standing in a T-pose, no background. "
    "Give `quadruped` true only for four-legged animals."
)
PLACE_SYSTEM = (
    "You are the set designer for a 3D game made from a novel. For each place you get quotes from the book, "
    "each with an id like q3. Describe the set: indoor or outdoor, its size in metres, the floor and the walls or "
    "the sky (in words and as #rrggbb colours), the light (day, dusk or night), and the set pieces that make it "
    "recognisable (furniture, plants, structures), each with a short 3D prompt, a count, its longest side in "
    "metres and where it stands. Follow the quotes and cite them; invent only what the place needs and say so."
)
OBJECT_SYSTEM = (
    "You are the prop maker for a 3D game made from a novel. For each object you get its description from "
    "the script and quotes from the book, each with an id like q3. Write a short 3D prompt for the object "
    "alone, its longest side in metres, and whether a person holds it in one hand. Cite the quotes you used."
)


@dataclass
class CharacterDesign:
    id: str
    prompt: str
    texture: str
    height_m: float
    quadruped: bool
    voice: str
    cites: list[str]
    invented: str


@dataclass
class PlaceDesign:
    id: str
    indoor: bool
    size_m: list[float]
    floor: str
    walls: str
    floor_color: str
    wall_color: str
    light: str
    pieces: list[dict]
    cites: list[str]
    invented: str


@dataclass
class ObjectDesign:
    id: str
    prompt: str
    size_m: float
    held: bool
    cites: list[str]


class Designer:
    def __init__(self, model: Model, evidence: Evidence):
        self.model, self.evidence = model, evidence

    def characters(self, people) -> list[CharacterDesign]:
        """`people`: index Persons. One request for all of them."""
        qs = [{"id": p.id, "question": f"What does {p.name} look like?", "query": f"{p.name} {' '.join(p.aliases)} hair face eyes tall small wore beard"} for p in people]
        quotes = self.evidence.find(qs)
        items, ids = _with_quotes([{"id": p.id, "name": p.name, "role": p.role, "index_notes": p.looks} for p in people], quotes)
        schema = obj({"designs": arr(obj({"id": S, "prompt": S, "texture": S, "height_m": N, "quadruped": B, "voice": S, "cites": arr(S), "invented": S}))})
        want = {p.id for p in people}

        def errors(a):
            got = {d["id"] for d in a["designs"]}
            out = [f"missing design for {i}" for i in want - got] + _cite_errors(a["designs"], ids)
            return out + [f"{d['id']}: height_m {d['height_m']} is not between 0.1 and 8" for d in a["designs"] if not 0.1 <= d["height_m"] <= 8]

        a = self.model.ask(CHARACTER_SYSTEM, "Design the characters", items, schema, effort="medium", check=errors)
        return [CharacterDesign(**d) for d in a["designs"] if d["id"] in want]

    def places(self, places: list[dict]) -> list[PlaceDesign]:
        """`places`: {"id", "description"} from the screenplays."""
        qs = [{"id": p["id"], "question": f"Where does the book describe {p['description']}?", "query": p["description"]} for p in places]
        quotes = self.evidence.find(qs)
        items, ids = _with_quotes(places, quotes)
        piece = obj({"id": S, "prompt": S, "count": {"type": "integer"}, "where": S, "size_m": N})
        schema = obj({"designs": arr(obj({"id": S, "indoor": B, "size_m": arr(N), "floor": S, "walls": S, "floor_color": S, "wall_color": S,
                                         "light": S, "pieces": arr(piece), "cites": arr(S), "invented": S}))})  # fmt: skip
        want = {p["id"] for p in places}

        def errors(a):
            out = [f"missing design for {i}" for i in want - {d["id"] for d in a["designs"]}] + _cite_errors(a["designs"], ids)
            out += [f"{d['id']}: size_m must be [width, depth] in metres" for d in a["designs"] if len(d["size_m"]) != 2 or min(d["size_m"]) <= 0]
            out += [f"{d['id']}: light must be day, dusk or night" for d in a["designs"] if d["light"] not in ("day", "dusk", "night")]
            return out + [f"{d['id']}: {k} must be #rrggbb" for d in a["designs"] for k in ("floor_color", "wall_color") if not re.fullmatch(r"#[0-9a-fA-F]{6}", d[k])]

        a = self.model.ask(PLACE_SYSTEM, "Design the places", items, schema, effort="medium", check=errors)
        return [PlaceDesign(**d) for d in a["designs"] if d["id"] in want]

    def objects(self, objects: list[dict]) -> list[ObjectDesign]:
        """`objects`: {"id", "name", "description"} from the screenplays."""
        qs = [{"id": o["id"], "question": f"Where does the book describe {o['name']}?", "query": f"{o['name']} {o['description']}"} for o in objects]
        quotes = self.evidence.find(qs, per=3)
        items, ids = _with_quotes(objects, quotes)
        schema = obj({"designs": arr(obj({"id": S, "prompt": S, "size_m": N, "held": B, "cites": arr(S)}))})
        want = {o["id"] for o in objects}

        def errors(a):
            return [f"missing design for {i}" for i in want - {d["id"] for d in a["designs"]}] + _cite_errors(a["designs"], ids)

        a = self.model.ask(OBJECT_SYSTEM, "Design the objects", items, schema, effort="low", check=errors)
        return [ObjectDesign(**d) for d in a["designs"] if d["id"] in want]


def _with_quotes(entries: list[dict], quotes: dict) -> tuple[list[dict], dict[str, set[str]]]:
    """Each entry with its quotes numbered q1, q2... and the ids each may cite."""
    items, ids = [], {}
    for e in entries:
        qs = quotes.get(e["id"], [])
        items.append({**e, "quotes": [{"id": f"q{k + 1}", "text": q.cite()} for k, q in enumerate(qs)]})
        ids[e["id"]] = {f"q{k + 1}" for k in range(len(qs))}
    return items, ids


def _cite_errors(designs: list[dict], ids: dict[str, set[str]]) -> list[str]:
    return [f"{d['id']} cites {c}, which is not one of its quotes" for d in designs for c in d["cites"] if c not in ids.get(d["id"], set())]


def as_dicts(designs) -> list[dict]:
    return [asdict(d) for d in designs]
