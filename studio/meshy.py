"""Meshy, the generative 3D service: models, rigs and animation clips.

Every Meshy job is a task: create it, poll until SUCCEEDED, download the
files (Meshy deletes them after three days). The `AssetStore` keeps each
result under a hash of its request, so an asset is paid for once and every
later build reuses the files.

Needs MESHY_API_KEY (a paid plan) in the environment or in game_novel/.env.
Field names follow docs.meshy.ai as read on 2026-11-26.
"""

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

BASE = "https://api.meshy.ai"
ROOT = Path(__file__).resolve().parent.parent
POLL_SECONDS = 5
TIMEOUT_SECONDS = 60 * 60


class MeshyError(RuntimeError):
    pass


@dataclass
class Asset:
    key: str
    files: dict[str, str]  # role ("model", "rigged", "clips") -> path relative to the store
    credits: int
    task: str


class AssetStore:
    """Generated files on disk, with an index of what made them."""

    def __init__(self, root: Path):
        self.root = root
        self.index_path = root / "assets.json"
        self.index: dict = json.loads(self.index_path.read_text()) if self.index_path.exists() else {}

    @staticmethod
    def key(kind: str, request: dict) -> str:
        return kind + "-" + hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16]

    def get(self, key: str) -> Asset | None:
        a = self.index.get(key)
        return Asset(key, a["files"], a["credits"], a["task"]) if a else None

    def put(self, asset: Asset, request: dict) -> None:
        self.index[asset.key] = {"files": asset.files, "credits": asset.credits, "task": asset.task, "request": request}
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path.write_text(json.dumps(self.index, indent=1))

    def path(self, rel: str) -> Path:
        return self.root / rel


class Meshy:
    """The calls the studio needs. `http` is an httpx-like client (tests pass a fake)."""

    def __init__(self, store: AssetStore, http=None, key: str | None = None):
        self.store = store
        self.key = key or api_key()
        if http is None:
            import httpx

            http = httpx.Client(base_url=BASE, timeout=60)
        self.http = http
        self.credits = 0

    # ---- what the studio asks for ---------------------------------------------

    def model(self, prompt: str, texture: str, character: bool) -> Asset:
        """A textured GLB from a description. Characters come in a T-pose with
        their feet at the origin, ready to rig."""
        preview = {"mode": "preview", "prompt": prompt[:800], "model_type": "smart-topology", "ai_model": "meshy-t2.5",
                   "target_formats": ["glb"], "origin_at": "bottom", **({"pose_mode": "t-pose"} if character else {})}  # fmt: skip
        key = self.store.key("model", {**preview, "texture": texture})
        if hit := self.store.get(key):
            return hit
        p = self._run("/openapi/v2/text-to-3d", preview)
        refine = {"mode": "refine", "preview_task_id": p["id"], "texture_prompt": texture[:800], "target_formats": ["glb"]}
        r = self._run("/openapi/v2/text-to-3d", refine)
        asset = Asset(key, {"model": self._download(r["model_urls"]["glb"], key, "model.glb")}, p.get("consumed_credits", 0) + r.get("consumed_credits", 0), r["id"])
        self.store.put(asset, {"preview": preview, "texture": texture})
        return asset

    def rig(self, model: Asset, height_m: float, quadruped: bool = False) -> Asset:
        """A skeleton (Mixamo bone names, so props attach to hands) and walk/run clips."""
        req = {"input_task_id": model.task, "animation_type": "quadruped" if quadruped else "biped",
               **({} if quadruped else {"height_meters": round(height_m, 2), "skeleton_template": "mixamo"})}  # fmt: skip
        key = self.store.key("rig", {**req, "model": model.key})
        if hit := self.store.get(key):
            return hit
        t = self._run("/openapi/v1/rigging", req)
        res = t["result"]
        files = {"rigged": self._download(res["rigged_character_glb_url"], key, "rigged.glb")}
        for name, urls in (res.get("basic_animations") or {}).items():
            if isinstance(urls, dict) and urls.get("glb"):
                files[name] = self._download(urls["glb"], key, f"{name}.glb")
        asset = Asset(key, files, t.get("consumed_credits", 0), t["id"])
        self.store.put(asset, req)
        return asset

    def clips(self, rig: Asset, action_ids: list[int]) -> Asset:
        """Library animations for a rig, merged into one GLB (one clip per action)."""
        ids = sorted(set(action_ids))
        key = self.store.key("clips", {"rig": rig.key, "actions": ids})
        if hit := self.store.get(key):
            return hit
        files, credits = {}, 0
        for k in range(0, len(ids), 10):  # at most ten actions per request
            part = ids[k : k + 10]
            t = self._run("/openapi/v1/animations", {"rig_task_id": rig.task, "action_ids": part})
            files[f"clips_{k // 10}"] = self._download(t["result"]["animation_glb_url"], key, f"clips_{k // 10}.glb")
            credits += t.get("consumed_credits", 0)
        asset = Asset(key, files, credits, rig.task)
        self.store.put(asset, {"rig": rig.key, "actions": ids})
        return asset

    def library(self) -> list[dict]:
        """Every animation in Meshy's library (free; cached on disk)."""
        cached = self.store.root / "animation-library.json"
        if cached.exists():
            return json.loads(cached.read_text())
        r = self.http.get("/openapi/v1/animations/library", headers=self._auth())
        self._ok(r)
        items = r.json()
        items = items.get("result", items) if isinstance(items, dict) else items
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(items))
        return items

    # ---- task plumbing ----------------------------------------------------------

    def _run(self, path: str, body: dict) -> dict:
        r = self.http.post(path, json=body, headers=self._auth())
        self._ok(r)
        task_id = r.json()["result"]
        started = time.time()
        while True:
            g = self.http.get(f"{path}/{task_id}", headers=self._auth())
            self._ok(g)
            t = g.json()
            if t["status"] == "SUCCEEDED":
                self.credits += t.get("consumed_credits", 0)
                log.info("meshy %s %s: %s credits", path.rsplit("/", 1)[-1], task_id, t.get("consumed_credits", "?"))
                return {"id": task_id, **t}
            if t["status"] in ("FAILED", "CANCELED"):
                raise MeshyError(f"{path} {task_id} {t['status']}: {(t.get('task_error') or {}).get('message', '')}")
            if time.time() - started > TIMEOUT_SECONDS:
                raise MeshyError(f"{path} {task_id} still {t['status']} after an hour")
            time.sleep(float(g.headers.get("Retry-After", POLL_SECONDS)))

    def _download(self, url: str, key: str, name: str) -> str:
        rel = f"{key}/{name}"
        dest = self.store.path(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        r = self.http.get(url)  # signed URL: no auth header
        self._ok(r)
        dest.write_bytes(r.content)
        return rel

    def _auth(self) -> dict:
        return {"Authorization": f"Bearer {self.key}"}

    @staticmethod
    def _ok(r) -> None:
        if r.status_code == 402:
            raise MeshyError("Meshy: no credits, or the plan has no API access (402)")
        if r.status_code >= 400:
            raise MeshyError(f"Meshy {r.status_code}: {r.text[:300]}")


def api_key() -> str:
    """MESHY_API_KEY from the environment or game_novel/.env (never printed)."""
    if os.environ.get("MESHY_API_KEY"):
        return os.environ["MESHY_API_KEY"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "MESHY_API_KEY" and value.strip():
                return value.strip().strip("'\"")
    raise MeshyError("set MESHY_API_KEY (a Meshy plan with API access) in the environment or game_novel/.env")
