import json
import os
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from pipeline.__main__ import book_hero, build_chapter, chain_json, load_catalog
from pipeline.analyze import analyze
from pipeline.assetgen import add_looks, add_places
from pipeline.text import load_chapters

router = APIRouter()

MAX_CHAPTERS = 40
ALLOWED = {".pdf", ".txt"}


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


def save_book(source: str, stories: list[dict]) -> dict:
    """Writes each chapter's story to the library and records the book."""
    book = _slug(source)
    folder = library_dir() / book
    folder.mkdir(exist_ok=True)
    chapters = []
    for i, s in enumerate(stories, 1):
        name = f"{i:02d}-{_slug(s['story']['title'])}.story.json"
        (folder / name).write_text(json.dumps(s["story"], ensure_ascii=False))
        chapters.append({"heading": s["heading"], "title": s["story"]["title"], "file": f"{book}/{name}", "events": s.get("events", [])})
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
    add_looks(chapters, analyses, library_dir() / _slug(source) / "looks.json")
    places = add_places(chapters, analyses, catalog, library_dir() / _slug(source) / "places.json")
    for ch, a in zip(chapters, analyses):
        try:
            story, _, _, _, chain = build_chapter(ch, catalog, source, hero, a, places)
            stories.append({"heading": ch.heading, "story": story, "events": chain_json(chain)})
        except Exception as e:  # one bad chapter should not sink the book
            skipped.append({"heading": ch.heading, "error": str(e)})
    book = save_book(source, stories) if stories else None
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
