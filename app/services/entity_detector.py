import re
from collections import Counter

CHARACTER_KEYWORDS = {
    "harry": ["harry"],
    "ron": ["ron weasley", "ron"],
    "hermione": ["hermione"],
    "hagrid": ["hagrid"],
    "dumbledore": ["dumbledore"],
    "mcgonagall": ["mcgonagall"],
    "snape": ["snape"],
    "quirrell": ["quirrell"],
    "malfoy": ["malfoy", "draco"],
    "dudley": ["dudley"],
    "vernon": ["vernon"],
    "petunia": ["petunia"],
    "neville": ["neville"],
    "filch": ["filch"],
    "voldemort": ["voldemort", "you-know-who"],
    "weasley_twins": ["fred", "george weasley"],
    "percy": ["percy"],
    "hedwig": ["hedwig"],
    "fang": ["fang"],
    "firenze": ["firenze"],
    "mrs_norris": ["mrs. norris", "mrs norris"],
}

OBJECT_KEYWORDS = {
    "wand": ["wand"],
    "broomstick": ["broomstick", "nimbus two thousand"],
    "cauldron": ["cauldron"],
    "owl": ["owl"],
    "dragon_egg": ["dragon egg", "norbert"],
    "sorcerers_stone": ["sorcerer's stone"],
    "golden_snitch": ["golden snitch", "snitch"],
    "chocolate_frog": ["chocolate frog"],
    "invisibility_cloak": ["invisibility cloak"],
    "key": ["golden key", "winged key"],
    "troll": ["troll"],
    "unicorn": ["unicorn"],
}

MAX_CHARACTERS = 8
MAX_OBJECTS = 8


def _score(text: str, keyword_map: dict) -> Counter:
    lower = text.lower()
    scores: Counter = Counter()
    for entity_id, keywords in keyword_map.items():
        for keyword in keywords:
            count = len(re.findall(r"\b" + re.escape(keyword) + r"\b", lower))
            if count:
                scores[entity_id] += count
    return scores


def detect_entities(text: str) -> dict:
    character_scores = _score(text, CHARACTER_KEYWORDS)
    object_scores = _score(text, OBJECT_KEYWORDS)

    characters = [entity_id for entity_id, _ in character_scores.most_common(MAX_CHARACTERS)]
    objects = [entity_id for entity_id, _ in object_scores.most_common(MAX_OBJECTS)]

    return {
        "characters": characters,
        "objects": objects,
    }
