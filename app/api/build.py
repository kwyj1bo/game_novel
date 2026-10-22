import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from pipeline.__main__ import build_chapter, load_catalog
from pipeline.text import load_chapters

router = APIRouter()

MAX_CHAPTERS = 40
ALLOWED = {".pdf", ".txt"}


@router.post("/api/build")
async def build(file: UploadFile = File(...)):
    """Turns an uploaded novel into one playable story per chapter."""
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
    for ch in chapters[:MAX_CHAPTERS]:
        try:
            story, *_ = build_chapter(ch, catalog, source)
            stories.append({"heading": ch.heading, "story": story})
        except Exception as e:  # one bad chapter should not sink the book
            skipped.append({"heading": ch.heading, "error": str(e)})
    return {"source": source, "stories": stories, "skipped": skipped}
