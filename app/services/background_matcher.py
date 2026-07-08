import os
import re
from collections import Counter
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parents[2] / "assets"

CATEGORY_KEYWORDS = {
    "fantasy": [
        "castle", "kingdom", "dragon", "wizard", "sword", "dungeon", "tavern",
        "knight", "throne", "elf", "dwarf", "orc", "sorcerer", "witch",
        "enchanted", "keep", "crown", "spell", "potion", "quest", "ruins",
        "tower", "cathedral", "monastery", "crypt",
    ],
    "scifi": [
        "spaceship", "planet", "alien", "laboratory", "robot", "galaxy",
        "station", "rocket", "spacecraft", "starship", "spacesuit", "colony",
        "cyborg", "android", "hologram", "starbase", "wormhole", "nebula",
        "asteroid", "orbit", "airlock",
    ],
    "western": [
        "desert", "saloon", "ranch", "sheriff", "cowboy", "canyon", "frontier",
        "stagecoach", "gunslinger", "homestead", "prairie", "outlaw", "rodeo",
        "cattle", "sagebrush", "wagon",
    ],
    "military": [
        "battlefield", "trench", "bunker", "tank", "warzone", "barracks",
        "outpost", "garrison", "artillery", "checkpoint", "warship",
        "battleship", "airbase", "fortress",
    ],
    "pirate": [
        "ship", "island", "treasure", "sea", "ocean", "harbor", "port",
        "pirate", "cove", "galleon", "shore", "lagoon", "shipwreck", "tide",
        "mast", "deck", "captain", "buccaneer",
    ],
    "winter": [
        "snow", "ice", "blizzard", "frost", "arctic", "glacier", "tundra",
        "avalanche", "igloo", "sleet", "icicle",
    ],
    "rural": [
        "farm", "village", "barn", "field", "countryside", "meadow",
        "pasture", "orchard", "windmill", "farmhouse", "silo", "crops",
    ],
    "nature": [
        "forest", "jungle", "river", "mountain", "wilderness", "cave",
        "valley", "swamp", "waterfall", "cliff", "lake", "marsh", "reef",
        "coral", "underwater", "seabed", "grove", "canopy",
    ],
    "modern": [
        "apartment", "downtown", "skyscraper", "subway", "mall", "highway",
        "parking lot", "suburb",
    ],
    "industrial": [
        "factory", "warehouse", "mine", "machinery", "refinery", "foundry",
        "smokestack", "assembly line", "conveyor", "scrapyard",
    ],
    "carnival": [
        "carnival", "fairground", "circus", "ferris wheel", "carousel",
        "sideshow", "arcade", "midway", "big top",
    ],
    "holiday": [
        "christmas", "halloween", "easter", "santa", "pumpkin", "festival",
        "fireworks", "costume", "trick-or-treat",
    ],
    "sports": [
        "stadium", "arena", "court", "scoreboard", "locker room",
        "tournament", "field goal", "bleachers",
    ],
    "whimsical": [
        "candy", "gumdrop", "lollipop", "mushroom", "fairy", "fairyland",
        "wonderland", "sugarcane", "toadstool",
    ],
}


def discover_asset_categories() -> dict[str, list[str]]:
    categories: dict[str, list[str]] = {}
    if not ASSETS_DIR.is_dir():
        return categories
    for entry in os.listdir(ASSETS_DIR):
        path = ASSETS_DIR / entry
        if not path.is_dir():
            continue
        category = entry.split("_", 1)[0]
        categories.setdefault(category, []).append(entry)
    return categories


def score_categories(text: str) -> Counter:
    lower = text.lower()
    scores: Counter = Counter()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            count = len(re.findall(r"\b" + re.escape(keyword) + r"\b", lower))
            if count:
                scores[category] += count
    return scores


def suggest_background(text: str) -> dict | None:
    scores = score_categories(text)
    if not scores:
        return None

    best_category, _ = scores.most_common(1)[0]
    packs = discover_asset_categories().get(best_category, [])

    return {
        "category": best_category,
        "scores": dict(scores),
        "packs": packs,
    }
