import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from pipeline.__main__ import book_hero, build_chapter, chain_json, load_catalog
from pipeline.analyze import analyze, hero_score
from pipeline.assetgen import add_looks, add_places
from pipeline.text import Chapter, load_chapters

router = APIRouter()

MAX_CHAPTERS = 40
ALLOWED = {".pdf", ".txt"}
MAX_CAST = 6  # characters a chapter can be played as
HERO_ID = re.compile(r"^[a-z0-9][a-z0-9 _-]{0,40}$")


def library_dir() -> Path:
    """Where built books are kept (NOVEL_LIBRARY overrides, e.g. in tests)."""
    root = Path(os.environ.get("NOVEL_LIBRARY", Path(__file__).resolve().parents[2] / "library"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "book"


def _index_path() -> Path:
    return library_dir() / "index.json"


def read_index() -> list[dict]:
    p = _index_path()
    return json.loads(p.read_text()) if p.exists() else []


def cast_of(a, hero: str | None) -> list[dict]:
    """The characters a chapter can be played as: people who act or speak in
    it, the book's hero first."""
    people = [c for c in a.characters.values() if c.kind == "human" and (c.named_actions or c.spoken)]
    people.sort(key=lambda c: (c.id != hero, -hero_score(c)))
    return [{"id": c.id, "name": c.name} for c in people[:MAX_CAST]]


def save_book(source: str, stories: list[dict]) -> dict:
    """Writes each chapter's story (and its text, for playing it as someone
    else) to the library and records the book."""
    book = _slug(source)
    folder = library_dir() / book
    folder.mkdir(exist_ok=True)
    shutil.rmtree(folder / "as", ignore_errors=True)  # chapters rebuilt as someone else go stale
    chapters = []
    for i, s in enumerate(stories, 1):
        name = f"{i:02d}-{_slug(s['story']['title'])}.story.json"
        (folder / name).write_text(json.dumps(s["story"], ensure_ascii=False))
        if "paragraphs" in s:
            text = {"heading": s["heading"], "title": s["story"]["title"], "paragraphs": s["paragraphs"]}
            (folder / name.replace(".story.json", ".text.json")).write_text(json.dumps(text, ensure_ascii=False))
        chapters.append({"heading": s["heading"], "title": s["story"]["title"], "file": f"{book}/{name}", "events": s.get("events", []), "cast": s.get("cast", [])})
    entry = {"id": book, "source": source, "chapters": chapters}
    index = [b for b in read_index() if b["id"] != book] + [entry]
    _index_path().write_text(json.dumps(index, indent=2, ensure_ascii=False))
    return entry


@router.post("/api/build")
async def build(file: UploadFile = File(...)):
    """Turns an uploaded novel into one playable story per chapter, and keeps it in the library."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(status_code=400, detail="Upload a .pdf or .txt file")
    data = await file.read()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"novel{suffix}"
        path.write_bytes(data)
        try:
            chapters = load_chapters(path)
        except Exception as e:  # unreadable PDF, wrong encoding
            raise HTTPException(status_code=400, detail=f"Could not read the file: {e}") from e
    if not chapters:
        raise HTTPException(status_code=422, detail="No chapters found in the file")
    catalog = load_catalog()
    source = Path(file.filename or "Novel").stem.replace("_", " ").replace("-", " ").title()
    stories, skipped = [], []
    chapters = chapters[:MAX_CHAPTERS]
    analyses = [analyze(ch.paragraphs, catalog) for ch in chapters]
    hero = book_hero(analyses)
    # Generated assets are shared by every book in the library.
    add_looks(chapters, analyses, library_dir() / "assets")
    places = add_places(chapters, analyses, catalog, library_dir() / "assets")
    for ch, a in zip(chapters, analyses):
        try:
            story, _, _, _, chain = build_chapter(ch, catalog, source, hero, a, places)
            stories.append({"heading": ch.heading, "story": story, "events": chain_json(chain), "paragraphs": ch.paragraphs, "cast": cast_of(a, hero)})
        except Exception as e:  # one bad chapter should not sink the book
            skipped.append({"heading": ch.heading, "error": str(e)})
    book = save_book(source, stories) if stories else None
    for s in stories:
        s.pop("paragraphs")  # kept in the library, not sent back
    return {"source": source, "book": book, "stories": stories, "skipped": skipped}


@router.get("/api/library")
def library():
    """Books built so far, with their chapters."""
    return read_index()


@router.get("/api/library/{book}/{name}")
def library_file(book: str, name: str):
    path = (library_dir() / book / name).resolve()
    if library_dir().resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="application/json")


@router.get("/api/library/{book}/{name}/as/{hero}")
def play_as(book: str, name: str, hero: str):
    """The chapter rebuilt around another character: their decisions become
    the choices. Built on first request from the saved text, then kept."""
    folder = (library_dir() / book).resolve()
    text_path = (folder / name.replace(".story.json", ".text.json")).resolve()
    ok = name.endswith(".story.json") and HERO_ID.match(hero) and library_dir().resolve() in folder.parents and folder in text_path.parents
    if not ok or not text_path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    out = folder / "as" / hero / name
    if not out.is_file():
        text = json.loads(text_path.read_text())
        catalog = load_catalog()
        chapter = Chapter(heading=text["heading"], title=text["title"], paragraphs=text["paragraphs"])
        a = analyze(chapter.paragraphs, catalog)
        if hero not in a.characters or a.characters[hero].kind != "human":
            raise HTTPException(status_code=404, detail=f"No character {hero} in this chapter")
        add_looks([chapter], [a], library_dir() / "assets")
        places = add_places([chapter], [a], catalog, library_dir() / "assets")
        source = next((b["source"] for b in read_index() if b["id"] == book), book)
        story = build_chapter(chapter, catalog, source, hero, a, places)[0]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(story, ensure_ascii=False))
    return FileResponse(out, media_type="application/json")
