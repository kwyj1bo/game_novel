import os
import re
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parents[2] / "assets"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg"}
EXCLUDE_NAME_PARTS = ("sample", "preview", "thumbs")

TYPE_KEYWORDS = {
    "character": [
        "character", "characters", "player", "players", "hero", "npc",
        "enemy", "enemies", "monster", "monsters", "pirate", "animal",
        "robot", "roguelike-char",
    ],
    "background": [
        "background", "backgrounds", "backdrop", "sky", "cloud", "map",
        "maps", "cartography", "scenery",
    ],
    "object": [
        "item", "items", "prop", "props", "object", "objects", "tile",
        "tiles", "block", "blocks", "weapon", "weapons", "door", "key",
        "crystal", "gem", "coin", "chest", "building", "buildings",
        "furniture", "vehicle", "vehicles", "tank", "plane", "ship",
    ],
}


def _is_image(path: Path) -> bool:
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        return False
    lower_name = path.name.lower()
    return not any(part in lower_name for part in EXCLUDE_NAME_PARTS)


def classify_file(path: Path, pack_name: str) -> str:
    haystack = " ".join(path.parts) + " " + pack_name
    tokens = set(re.findall(r"[a-zA-Z]+", haystack.lower()))
    for category in ("character", "background", "object"):
        for keyword in TYPE_KEYWORDS[category]:
            if keyword in tokens:
                return category
    return "object"


def get_pack_assets(pack_name: str) -> dict[str, list[str]]:
    pack_dir = ASSETS_DIR / pack_name
    result: dict[str, list[str]] = {"background": [], "character": [], "object": []}

    if not pack_dir.is_dir():
        return result

    for root, _dirs, files in os.walk(pack_dir):
        for filename in files:
            file_path = Path(root) / filename
            if not _is_image(file_path):
                continue
            category = classify_file(file_path, pack_name)
            relative_path = file_path.relative_to(ASSETS_DIR).as_posix()
            result[category].append(relative_path)

    return result


def get_assets_for_category(category: str, packs: list[str], limit_per_type: int = 5) -> dict[str, list[str]]:
    combined: dict[str, list[str]] = {"background": [], "character": [], "object": []}

    for pack_name in packs:
        pack_assets = get_pack_assets(pack_name)
        for asset_type, paths in pack_assets.items():
            combined[asset_type].extend(paths)

    return {
        asset_type: paths[:limit_per_type]
        for asset_type, paths in combined.items()
    }
