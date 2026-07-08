import re

CHAPTER_HEADING_RE = re.compile(
    r"^(chapter\s+\w+|prologue|epilogue|part\s+\w+|book\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+))\b",
    re.IGNORECASE,
)

MAX_HEADING_LENGTH = 60


def _is_chapter_heading(line: str) -> bool:
    if not line or len(line) > MAX_HEADING_LENGTH:
        return False
    return bool(CHAPTER_HEADING_RE.match(line))


def split_into_chapters(pages_text: list[str]) -> list[dict]:
    chapters: list[dict] = []
    current_title = None
    current_lines: list[str] = []

    def flush():
        if current_title is None and not current_lines:
            return
        text = " ".join(" ".join(current_lines).split())
        if current_title is None and not text:
            return
        chapters.append({"title": current_title or "Untitled", "text": text})

    for page in pages_text:
        for raw_line in page.splitlines():
            line = raw_line.strip()
            if _is_chapter_heading(line):
                flush()
                current_title = line
                current_lines = []
            elif line:
                current_lines.append(line)

    flush()
    return chapters
