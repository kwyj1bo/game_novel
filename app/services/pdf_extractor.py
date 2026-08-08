import fitz  # PyMuPDF

from app.services.background_matcher import suggest_background
from app.services.chapter_splitter import split_into_chapters
from app.services.content_filter import extract_content_pages
from app.services.entity_detector import detect_entities
from app.services.location_detector import detect_location, segment_scenes


def extract_pages_text(pdf_bytes: bytes) -> list[str]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def extract_novel_text(pdf_bytes: bytes) -> str:
    pages_text = extract_pages_text(pdf_bytes)
    content_pages = extract_content_pages(pages_text)
    return " ".join(" ".join(page.split()) for page in content_pages)


def extract_novel_chapters(pdf_bytes: bytes) -> list[dict]:
    pages_text = extract_pages_text(pdf_bytes)
    content_pages = extract_content_pages(pages_text)
    chapters = split_into_chapters(content_pages)

    for chapter in chapters:
        chapter["background"] = suggest_background(chapter["text"])
        chapter["location"] = detect_location(chapter["text"])
        chapter["entities"] = detect_entities(chapter["text"])

        scenes = segment_scenes(chapter["text"])
        for scene in scenes:
            scene["entities"] = detect_entities(scene["text"])
        chapter["scenes"] = scenes

    return chapters
