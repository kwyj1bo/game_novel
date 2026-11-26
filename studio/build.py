"""The whole chain for one chapter, as `python -m studio build` runs it."""

import json
from dataclasses import asdict
from pathlib import Path

from .assemble import Assembler, story_id
from .bible import Designer
from .director import Director
from .index import BookIndex
from .llm import Model
from .modeler import Modeler
from .production import Production, save
from .rag import Evidence
from .screenplay import Screenplay, ScreenplayWriter


def build_chapter(model: Model, book: Path, chapters, n: int) -> str:
    work = book / "studio"
    index = BookIndex.load(work / "index.json")
    names = {p.id: p.name for p in index.cast}
    sp_path = work / f"c{n}.screenplay.json"
    if sp_path.exists():
        sp = Screenplay(**json.loads(sp_path.read_text()))
    else:
        sp = ScreenplayWriter(model, index).write(n - 1, chapters[n - 1])
        sp_path.write_text(json.dumps(asdict(sp), indent=1, ensure_ascii=False))

    production = Production(Designer(model, Evidence(model, index, chapters)), Modeler(model), index).run([sp])
    save(work / f"c{n}.production.json", production)

    director = Director(model)
    places = [{"id": p["id"], "size_m": p["size_m"], "pieces": [{k: x[k] for k in ("id", "count", "where", "size_m")} for x in p["pieces"]]} for p in production["places"]]
    layout = director.layout(places) if places else {}
    sets = {p["id"]: {"size_m": p["size_m"], "pieces": layout.get(p["id"], [])} for p in production["places"]}
    props = set(production["props"]) & {o["id"] for o in sp.objects}
    uses = {who: list(b["uses"]) for who, b in production["built"].items()}
    staging = director.stage(sp, sets, uses, props)

    story = Assembler(names, production, layout).story(sp, staging, story_id(book.name, sp.title), "AI studio")
    out = book / f"studio-c{n}.story.json"
    out.write_text(json.dumps(story, ensure_ascii=False))
    built = sum(1 for a in story["actors"].values() if "built" in a)
    return f"chapter {n}: {out} ({len(story['scenes'])} scenes, {built} of {len(story['actors'])} actors built)"
