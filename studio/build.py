"""The whole chain for one chapter, as `python -m studio build` runs it."""

import json
from dataclasses import asdict
from pathlib import Path

from .assemble import Assembler, clip_names, story_id
from .bible import Designer
from .director import Director
from .index import BookIndex
from .llm import Model
from .production import Production, needs, save
from .rag import Evidence
from .screenplay import Screenplay, ScreenplayWriter


def build_chapter(model: Model, book: Path, chapters, n: int, generate: bool, assets_root: Path) -> str:
    work = book / "studio"
    index = BookIndex.load(work / "index.json")
    names = {p.id: p.name for p in index.cast}
    sp_path = work / f"c{n}.screenplay.json"
    if sp_path.exists():
        sp = Screenplay(**json.loads(sp_path.read_text()))
    else:
        sp = ScreenplayWriter(model, index).write(n - 1, chapters[n - 1])
        sp_path.write_text(json.dumps(asdict(sp), indent=1, ensure_ascii=False))

    designer = Designer(model, Evidence(model, index, chapters))
    meshy = None
    library: list[dict] = []
    if generate:
        from .meshy import AssetStore, Meshy

        meshy = Meshy(AssetStore(assets_root))
        library = meshy.library()
    prod = Production(model, designer, index, meshy)
    if generate:
        plan = prod.plan([sp], library)
        print(f"estimated Meshy credits: {plan['estimate_credits']}")
        assets = prod.generate(plan)
        uses = clip_names(plan["clips"], library)
    else:
        need = needs([sp])
        plan = {"characters": [asdict(c) for c in designer.characters([p for p in index.cast if p.id in need["people"]])],
                "places": [asdict(p) for p in designer.places(need["places"])], "objects": [], "clips": {}}  # fmt: skip
        assets, uses = {}, {}
    save(work / f"c{n}.production.json", plan, assets)

    director = Director(model)
    places = [{"id": p["id"], "size_m": p["size_m"], "pieces": [{k: x[k] for k in ("id", "count", "where", "size_m")} for x in p["pieces"]]} for p in plan["places"]]
    layout = director.layout(places) if places else {}
    sets = {p["id"]: {"size_m": p["size_m"], "pieces": layout.get(p["id"], [])} for p in plan["places"]}
    props = set(assets.get("props", {})) & {o["id"] for o in sp.objects}
    actor_uses = {who: list(uses.get(who, {})) for who in needs([sp])["people"]}
    staging = director.stage(sp, sets, actor_uses, props)

    story = Assembler(names, plan, assets, uses, layout).story(sp, staging, story_id(book.name, sp.title), "AI studio")
    out = book / f"studio-c{n}.story.json"
    out.write_text(json.dumps(story, ensure_ascii=False))
    return f"chapter {n}: {out} ({len(story['scenes'])} scenes, {len(story['actors'])} actors, {'3D' if generate else 'placeholder'} assets)"
