"""The upload endpoint turns a file into playable stories."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIX = Path(__file__).parent / "fixtures"
client = TestClient(app)


def test_upload_text_novel_returns_a_story_per_chapter():
    data = (FIX / "lighthouse.txt").read_bytes()
    r = client.post("/api/build", files={"file": ("the_lighthouse.txt", data, "text/plain")})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "The Lighthouse"
    assert len(body["stories"]) == 1
    story = body["stories"][0]["story"]
    assert story["title"] == "The Keeper's Hall"
    assert any("choice" in s for s in story["scenes"].values())


def test_rejects_other_file_types():
    r = client.post("/api/build", files={"file": ("book.epub", b"x", "application/epub+zip")})
    assert r.status_code == 400


def test_reports_a_file_without_chapters():
    r = client.post("/api/build", files={"file": ("empty.txt", b"   ", "text/plain")})
    assert r.status_code == 422
