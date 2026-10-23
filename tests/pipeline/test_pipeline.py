"""End-to-end checks of the novel pipeline on original fixture chapters."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline.__main__ import ROOT, build_chapter, load_catalog
from pipeline.text import load_chapters

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


def build(name, catalog):
    ch = load_chapters(FIX / name)[0]
    return build_chapter(ch, catalog, "Fixture")


@pytest.fixture(scope="module")
def halloween(catalog):
    return build("halloween.txt", catalog)


@pytest.fixture(scope="module")
def lighthouse(catalog):
    return build("lighthouse.txt", catalog)


def test_chapter_heading_and_title():
    ch = load_chapters(FIX / "halloween.txt")[0]
    assert ch.heading == "CHAPTER TEN"
    assert ch.title == "The Troll"


def test_characters_kinds_and_genders(halloween, lighthouse):
    a = halloween[1]
    got = {c.id: (c.kind, c.gender) for c in a.characters.values()}
    assert got == {
        "harry": ("human", "m"),
        "ron": ("human", "m"),
        "hermione": ("human", "f"),
        "mcgonagall": ("human", "f"),
        "troll": ("troll", "n"),
    }
    assert a.protagonist == "harry"
    b = lighthouse[1]
    assert {c.id: (c.kind, c.gender) for c in b.characters.values()} == {
        "mara": ("human", "f"),
        "tobin": ("human", "m"),
        "dog": ("dog3", "n"),
    }


def test_every_line_of_dialogue_has_the_right_speaker(halloween, lighthouse):
    said = [ln.speaker for ln in halloween[1].lines if ln.kind == "say"]
    assert said == [
        "harry", "ron", "ron", "ron", "harry", "ron", "harry", "harry", "hermione", "ron",
        "harry", "harry", "ron", "hermione", "harry", "mcgonagall", "mcgonagall", "hermione", "hermione",
    ]
    said = [ln.speaker for ln in lighthouse[1].lines if ln.kind == "say"]
    assert said == ["mara", "mara", "tobin", "tobin", "mara", "tobin", "mara", "tobin", "mara"]


def test_speech_tags_are_not_narration(halloween):
    narr = [ln.text for ln in halloween[1].lines if ln.kind == "narrate"]
    assert "Ron asked." not in narr
    assert not any(t.startswith('"') for t in narr)


def test_choices_are_the_heros_action_and_its_opposite(halloween, lighthouse):
    assert [(m.correct, m.opposite) for m in halloween[3]] == [
        ("Unlock the door", "Leave the door locked"),
        ("Run at the troll", "Keep away from the troll"),
    ]
    assert [(m.correct, m.opposite) for m in lighthouse[3]] == [("Pick up the lantern", "Leave the lantern where it is")]


def test_scenes_follow_locations(halloween):
    assert [s.location for s in halloween[2]] == ["castle_corridor", "girls_bathroom"]


def test_wrong_branches_end_the_run(halloween):
    story = halloween[0]
    for scene in story["scenes"].values():
        if "choice" not in scene:
            continue
        wrong = next(o for o in scene["choice"]["options"] if not o["correct"])
        assert story["scenes"][wrong["goto"]]["ending"]["kind"] in ("death", "failure")


def test_people_only_talked_about_are_not_on_stage(halloween):
    first = halloween[0]["scenes"]["scene_1"]
    assert "hermione" not in first["cast"]
    assert "troll" not in first["cast"]
    assert any(b.get("spawn") == "troll" for b in first["beats"])


def test_build_is_deterministic(catalog, halloween):
    again = build("halloween.txt", catalog)
    assert json.dumps(again[0], sort_keys=True) == json.dumps(halloween[0], sort_keys=True)


@pytest.mark.skipif(shutil.which("npx") is None, reason="needs Node for the engine validator")
@pytest.mark.parametrize("name", ["halloween.txt", "lighthouse.txt"])
def test_engine_validator_accepts_generated_story(catalog, tmp_path, name):
    story = build(name, catalog)[0]
    path = tmp_path / "story.json"
    path.write_text(json.dumps(story))
    r = subprocess.run(["npx", "vite-node", "scripts/validate-story.ts", str(path)], cwd=ROOT / "web", capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


# ---- whole books: chapters, hero, sceneries and cast all come from the manifest


@pytest.fixture(scope="module")
def hp_book(catalog):
    from pipeline.__main__ import build_book

    return build_book(load_chapters(FIX / "hp_book.txt"), catalog, "Fixture")


@pytest.fixture(scope="module")
def voyage(catalog):
    from pipeline.__main__ import build_book

    return build_book(load_chapters(FIX / "voyage.txt"), catalog, "Fixture")


def _locations(story):
    return list(dict.fromkeys(s["location"] for k, s in story["scenes"].items() if not k.endswith("_wrong")))


def test_book_splits_into_chapters():
    assert [c.title for c in load_chapters(FIX / "hp_book.txt")] == ["The Letters", "The Alley", "The Forest"]


def test_each_chapter_picks_its_scenery_from_the_manifest(hp_book, voyage):
    assert [_locations(r[0]) for r in hp_book] == [["privet_drive"], ["diagon_alley", "gringotts"], ["forbidden_forest"]]
    assert [_locations(r[0]) for r in voyage] == [["generic_tavern"], ["generic_deck"]]


def test_hero_is_decided_by_the_whole_book(hp_book, voyage):
    assert {r[1].protagonist for r in hp_book} == {"harry"}
    assert {r[1].protagonist for r in voyage} == {"elena"}


def test_characters_use_manifest_assets_and_merge_aliases(hp_book):
    letters = hp_book[0][0]
    assert sorted(letters["actors"]) == ["dudley", "harry", "petunia", "vernon"]
    # "Uncle Vernon" and "Mr. Dursley" are one person with the manifest's look.
    assert letters["actors"]["vernon"]["name"] == "Uncle Vernon"
    assert "gringotts" not in hp_book[1][0]["actors"]


def test_unknown_characters_get_generated_looks(voyage):
    elena = voyage[0][0]["actors"]["elena"]
    assert elena["name"] == "Elena" and elena["hairStyle"] in ("bushy", "long", "bun")


def test_book_choices(hp_book, voyage):
    pairs = [(m.correct, m.opposite) for r in hp_book + voyage for m in r[3]]
    assert pairs == [
        ("Grab the letter", "Leave the letter"),
        ("Take the key from Hagrid", "Refuse the key"),
        ("Step towards the clearing", "Hold back"),
        ("Take the innkeeper's hand", "Refuse the handshake"),
        ("Run to the sailor", "Keep away from the sailor"),
    ]


def test_actions_that_did_not_happen_are_ignored(hp_book):
    # "Harry did not run" must not become "Run" / "Stand still".
    forest = hp_book[2][1]
    assert not any(e.actor == "harry" and e.verb == "run" for ln in forest.lines for e in ln.events)


# ---- the event chain: only the important events are shown


def test_chain_links_each_event_to_the_next(halloween):
    chain = halloween[4]
    assert [n.next for n in chain] == [n.id for n in chain[1:]] + [None]
    assert [n.para for n in chain] == sorted(n.para for n in chain)


def test_chain_keeps_the_turning_points(halloween):
    summaries = [n.summary for n in halloween[4]]
    for must in [
        "Then a high, terrified scream came from behind the door.",
        "Harry unlocked the door and pulled it open.",
        "Harry ran at the troll and jumped onto its back.",
        "Ron raised his wand.",
    ]:
        assert must in summaries
    assert [n.choice for n in halloween[4]].count(True) == 2


def test_chain_drops_minor_paragraphs(halloween):
    a = halloween[1]
    total = len({ln.para for ln in a.lines})
    assert len(halloween[4]) <= total * 0.55
    summaries = " ".join(n.summary for n in halloween[4])
    assert "A foul smell drifted" not in summaries


def test_story_shows_only_chain_lines(halloween):
    story = halloween[0]
    shown = [b.get("narrate") or b.get("say") and b["text"] for s in story["scenes"].values() for b in s["beats"]]
    shown = [t for t in shown if t]
    chain_text = {ln.text for n in halloween[4] for ln in n.lines}
    generated = {"Harry hesitates", "The moment slips away"}
    assert all(t in chain_text or t.strip("“”") in chain_text or any(t.startswith(g) for g in generated) for t in shown)
    assert len(shown) < len(halloween[1].lines)


def test_each_event_shows_at_most_two_lines_of_dialogue(halloween):
    for n in halloween[4]:
        if not n.choice:
            assert sum(1 for ln in n.lines if ln.kind == "say") <= 2
