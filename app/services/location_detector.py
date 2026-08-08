import re
from collections import Counter

# Canonical locations mapped to keywords that identify them in the text.
# Keywords are matched as whole words/phrases, case-insensitive.
LOCATION_KEYWORDS = {
    "privet_drive": [
        "privet drive", "number four", "dursley", "cupboard under the stairs",
    ],
    "mrs_figgs_house": [
        "mrs. figg", "mrs figg",
    ],
    "zoo_reptile_house": [
        "reptile house", "boa constrictor", "the zoo",
    ],
    "hogwarts_great_hall": [
        "great hall", "house table", "sorting hat", "house cup", "high table",
        "start-of-term banquet",
    ],
    "gryffindor_common_room": [
        "common room", "fat lady", "gryffindor tower", "four-poster",
    ],
    "dungeon_potions": [
        "dungeon", "potions class", "cauldron", "snape's classroom",
    ],
    "charms_classroom": [
        "charms class", "professor flitwick", "wingardium leviosa",
    ],
    "transfiguration_classroom": [
        "transfiguration class", "professor mcgonagall's class",
        "turn a mouse", "turn a match",
    ],
    "history_of_magic_classroom": [
        "history of magic", "professor binns",
    ],
    "defense_dark_arts_classroom": [
        "defense against the dark arts", "professor quirrell's class",
        "quirrell's classroom",
    ],
    "herbology_greenhouse": [
        "herbology", "greenhouse", "professor sprout",
    ],
    "hospital_wing": [
        "hospital wing", "madam pomfrey",
    ],
    "boathouse_lake": [
        "the lake", "little boats", "boats sailed", "boathouse",
    ],
    "diagon_alley": [
        "diagon alley", "leaky cauldron", "flourish and blotts",
    ],
    "ollivanders": [
        "ollivander", "wand chooses the wizard",
    ],
    "madam_malkins": [
        "madam malkin",
    ],
    "gringotts": [
        "gringotts", "goblin", "vault",
    ],
    "kings_cross": [
        "king's cross", "platform nine", "platform 9", "hogwarts express",
    ],
    "forbidden_forest": [
        "forbidden forest", "centaur", "unicorn blood", "hagrid's crossbow",
    ],
    "hut_on_the_rock": [
        "hut-on-the-rock", "hut on the rock", "rowboat",
    ],
    "third_floor_corridor": [
        "trapdoor", "three-headed dog", "fluffy",
    ],
    "flying_keys_chamber": [
        "flying keys", "winged keys", "golden key",
    ],
    "chessboard_chamber": [
        "chessboard", "giant chess", "chessmen",
    ],
    "mirror_of_erised_room": [
        "mirror of erised", "sorcerer's stone",
    ],
    "quidditch_pitch": [
        "quidditch pitch", "quidditch match", "golden snitch", "chaser",
        "broomstick", "seeker",
    ],
    "hagrids_hut": [
        "hagrid's hut", "hagrid's cabin", "fang",
    ],
}


def score_locations(text: str) -> Counter:
    lower = text.lower()
    scores: Counter = Counter()
    for location, keywords in LOCATION_KEYWORDS.items():
        for keyword in keywords:
            count = len(re.findall(re.escape(keyword), lower))
            if count:
                scores[location] += count
    return scores


def detect_location(text: str) -> dict | None:
    scores = score_locations(text)
    if not scores:
        return None

    best_location, _ = scores.most_common(1)[0]
    return {
        "location": best_location,
        "scores": dict(scores),
    }


CHUNK_WORDS = 250


def segment_scenes(text: str) -> list[dict]:
    """Split chapter text into ordered chunks and detect the location of each,
    merging consecutive chunks that share the same location into one scene.
    Chunks with no recognizable location inherit the previous scene's location
    so the story doesn't lose a beat between two rooms in the same place.
    """
    words = text.split()
    if not words:
        return []

    chunks = [
        " ".join(words[i:i + CHUNK_WORDS])
        for i in range(0, len(words), CHUNK_WORDS)
    ]

    raw_locations: list[str | None] = []
    for chunk in chunks:
        scores = score_locations(chunk)
        raw_locations.append(scores.most_common(1)[0][0] if scores else None)

    # Fill leading Nones with the first known location; fill the rest by
    # carrying the previous chunk's location forward.
    first_known = next((loc for loc in raw_locations if loc), None)
    filled: list[str] = []
    last = first_known
    for loc in raw_locations:
        if loc:
            last = loc
        filled.append(last)

    scenes: list[dict] = []
    for chunk, location in zip(chunks, filled):
        if not location:
            continue
        if scenes and scenes[-1]["location"] == location:
            scenes[-1]["text"] += " " + chunk
        else:
            scenes.append({"location": location, "text": chunk})

    return scenes
