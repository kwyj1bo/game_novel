"""Load a novel (PDF or plain text) and split it into chapters of paragraphs."""

import re
from dataclasses import dataclass, field
from pathlib import Path

CHAPTER_RE = re.compile(
    r"^(chapter\s+[\w-]+|prologue|epilogue|part\s+[\w-]+|book\s+[\w-]+)\b",
    re.IGNORECASE,
)


@dataclass
class Chapter:
    heading: str
    title: str
    paragraphs: list[str] = field(default_factory=list)


def _is_heading(line: str) -> bool:
    return 0 < len(line) <= 60 and bool(CHAPTER_RE.match(line))


def _clean(text: str) -> str:
    text = text.replace("­", "")  # soft hyphens from PDFs
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # words hyphenated across lines
    return " ".join(text.split())


def paragraphs_from_text(raw: str) -> list[str]:
    """Plain text: paragraphs are separated by blank lines. A chapter heading
    sharing a block with its title ("CHAPTER TEN" / "The Troll") is split."""
    out: list[str] = []
    for block in re.split(r"\n\s*\n", raw):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if len(lines) > 1 and _is_heading(lines[0]):
            out.append(lines[0])
            block = "\n".join(lines[1:])
        p = _clean(block)
        if p:
            out.append(p)
    return out


def paragraphs_from_pdf(path: Path) -> list[str]:
    """PDF: each text block is roughly a paragraph. Page furniture (short
    numeric blocks such as page numbers) is dropped."""
    import fitz  # PyMuPDF

    paras: list[str] = []
    with fitz.open(path) as doc:
        for page in doc:
            for block in page.get_text("blocks"):
                text = block[4]
                cleaned = _clean(text)
                if not cleaned or cleaned.isdigit():
                    continue
                # A block can hold several short lines that are separate paragraphs
                # (headings); split headings out so chapter detection sees them.
                lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                if lines and _is_heading(lines[0]) and len(lines) > 1:
                    paras.append(lines[0])
                    paras.append(_clean("\n".join(lines[1:])))
                else:
                    paras.append(cleaned)
    return paras


def split_chapters(paragraphs: list[str]) -> list[Chapter]:
    """Group paragraphs under chapter headings. The line after a heading is
    taken as the chapter title when it is short and has no sentence ending."""
    chapters: list[Chapter] = []
    current: Chapter | None = None
    expect_title = False
    for p in paragraphs:
        if _is_heading(p):
            current = Chapter(heading=p, title=p)
            chapters.append(current)
            expect_title = True
            continue
        if current is None:
            current = Chapter(heading="Untitled", title="Untitled")
            chapters.append(current)
        if expect_title and len(p) <= 60 and not p.endswith((".", "!", "?", '"', "”")):
            current.title = p
            expect_title = False
            continue
        expect_title = False
        current.paragraphs.append(p)
    return [c for c in chapters if c.paragraphs]


def load_chapters(path: str | Path) -> list[Chapter]:
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        paras = paragraphs_from_pdf(path)
    else:
        paras = paragraphs_from_text(path.read_text(encoding="utf-8"))
    return split_chapters(paras)
