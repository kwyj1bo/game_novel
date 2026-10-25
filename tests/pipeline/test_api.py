"""The upload endpoint turns a file into playable stories."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIX = Path(__file__).parent / "fixtures"
client = TestClient(app)


@pytest.fixture(autouse=True)
def library(tmp_path, monkeypatch):
    monkeypatch.setenv("NOVEL_LIBRARY", str(tmp_path / "library"))


def test_upload_text_novel_returns_a_story_per_chapter():
    data = (FIX / "lighthouse.txt").read_bytes()
    r = client.post("/api/build", files={"file": ("the_lighthouse.txt", data, "text/plain")})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "The Lighthouse"
    assert len(body["stories"]) == 1
    story = body["stories"][0]["story"]
    assert story["title"] == "The Keeper's Hall"
    events = body["stories"][0]["events"]
    assert events[0]["id"] == "e1" and events[-1]["next"] is None
    assert any(e["choice"] for e in events)
    assert any("choice" in s for s in story["scenes"].values())


def test_rejects_other_file_types():
    r = client.post("/api/build", files={"file": ("book.epub", b"x", "application/epub+zip")})
    assert r.status_code == 400


def test_reports_a_file_without_chapters():
    r = client.post("/api/build", files={"file": ("empty.txt", b"   ", "text/plain")})
    assert r.status_code == 422


def test_built_books_are_kept_in_the_library():
    data = (FIX / "hp_book.txt").read_bytes()
    r = client.post("/api/build", files={"file": ("philosophers_stone.txt", data, "text/plain")})
    assert r.status_code == 200
    books = client.get("/api/library").json()
    assert [b["source"] for b in books] == ["Philosophers Stone"]
    chapters = books[0]["chapters"]
    assert [c["title"] for c in chapters] == ["The Letters", "The Alley", "The Forest"]
    story = client.get(f"/api/library/{chapters[0]['file']}").json()
    assert story["title"] == "The Letters"


def test_library_files_cannot_escape_the_folder():
    assert client.get("/api/library/..%2F..%2Fapp/main.py").status_code == 404


def test_a_chapter_can_be_played_as_another_character(tmp_path):
    data = (FIX / "hp_book.txt").read_bytes()
    client.post("/api/build", files={"file": ("philosophers_stone.txt", data, "text/plain")})
    alley = client.get("/api/library").json()[0]["chapters"][1]
    cast = [c["id"] for c in alley["cast"]]
    assert cast[0] == "harry" and "hagrid" in cast
    r = client.get(f"/api/library/{alley['file']}/as/hagrid")
    assert r.status_code == 200
    ending = next(s["ending"] for s in r.json()["scenes"].values() if "ending" in s)
    assert "Hagrid" in ending["text"]
    # Built once, then kept.
    assert (tmp_path / "library" / alley["file"].replace("/", "/as/hagrid/")).is_file()


def test_playing_as_someone_not_in_the_chapter_is_refused():
    data = (FIX / "hp_book.txt").read_bytes()
    client.post("/api/build", files={"file": ("philosophers_stone.txt", data, "text/plain")})
    alley = client.get("/api/library").json()[0]["chapters"][1]["file"]
    assert client.get(f"/api/library/{alley}/as/voldemort").status_code == 404
    assert client.get(f"/api/library/{alley}/as/..%2F..").status_code == 404


def test_uploading_a_book_again_drops_old_rebuilds(tmp_path):
    data = (FIX / "hp_book.txt").read_bytes()
    client.post("/api/build", files={"file": ("philosophers_stone.txt", data, "text/plain")})
    alley = client.get("/api/library").json()[0]["chapters"][1]["file"]
    client.get(f"/api/library/{alley}/as/hagrid")
    client.post("/api/build", files={"file": ("philosophers_stone.txt", data, "text/plain")})
    assert not (tmp_path / "library" / "philosophers-stone" / "as").exists()
