import re

CHAPTER_START_RE = re.compile(
    r"^\s*(chapter\s+\w+|prologue|part\s+\w+|book\s+(one|two|three|\d+)|epilogue)\b",
    re.IGNORECASE,
)

FRONT_MATTER_KEYWORDS = (
    "all rights reserved",
    "isbn",
    "library of congress",
    "table of contents",
    "contents",
    "dedication",
    "dedicated to",
    "acknowledg",
    "preface",
    "foreword",
    "also by",
    "praise for",
    "copyright ©",
    "copyright (c)",
    "title page",
)

BACK_MATTER_KEYWORDS = (
    "about the author",
    "acknowledg",
    "excerpt from",
    "read on for",
    "keep reading for",
    "discussion questions",
    "reading group guide",
    "also by",
)


def is_front_matter_page(text: str) -> bool:
    stripped = text.strip()
    lower = stripped.lower()
    if not stripped:
        return True
    if any(keyword in lower for keyword in FRONT_MATTER_KEYWORDS):
        return True
    # Short, sparse pages before the story starts are usually title/blank pages.
    if len(stripped.split()) < 40:
        return True
    return False


def find_content_start(pages_text: list[str]) -> int:
    for i, text in enumerate(pages_text):
        if CHAPTER_START_RE.match(text.strip()):
            return i

    for i, text in enumerate(pages_text):
        if not is_front_matter_page(text):
            return i

    return 0


def find_content_end(pages_text: list[str], start: int) -> int:
    tail_start = max(start + 1, int(len(pages_text) * 0.85))
    for i in range(tail_start, len(pages_text)):
        lower = pages_text[i].strip().lower()
        if any(keyword in lower for keyword in BACK_MATTER_KEYWORDS):
            return i
    return len(pages_text)


def extract_content_pages(pages_text: list[str]) -> list[str]:
    start = find_content_start(pages_text)
    end = find_content_end(pages_text, start)
    return pages_text[start:end]
