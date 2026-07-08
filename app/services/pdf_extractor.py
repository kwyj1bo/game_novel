import fitz  # PyMuPDF

from app.services.content_filter import extract_content_pages


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
