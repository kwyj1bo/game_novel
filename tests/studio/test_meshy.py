"""The Meshy client against a recorded fake: task flow, downloads, caching."""

import pytest

from studio.meshy import AssetStore, Meshy, MeshyError


class Resp:
    def __init__(self, data=None, content=b"", status=200):
        self._data, self.content, self.status_code, self.headers, self.text = data, content, status, {"Retry-After": "0"}, ""

    def json(self):
        return self._data


class FakeHttp:
    """Answers like Meshy: a task id on create, SUCCEEDED on the first poll."""

    def __init__(self, fail: str | None = None):
        self.posts, self.n, self.fail = [], 0, fail

    def post(self, path, json, headers):
        assert headers["Authorization"] == "Bearer test-key"
        self.posts.append((path, json))
        self.n += 1
        return Resp({"result": f"t{self.n}"})

    def get(self, path, headers=None):
        if path.startswith("https://"):
            return Resp(content=b"glTF" + path.encode())
        if path.endswith("/library"):
            return Resp([{"action_id": 0, "name": "Idle", "rig_type": "biped"}])
        task = path.rsplit("/", 1)[-1]
        if self.fail and self.fail in path:
            return Resp({"status": "FAILED", "task_error": {"message": "pose estimation failed"}})
        if "rigging" in path:
            return Resp({"status": "SUCCEEDED", "consumed_credits": 5, "result": {
                "rigged_character_glb_url": f"https://cdn/{task}/rigged.glb",
                "basic_animations": {"walking": {"glb": f"https://cdn/{task}/walk.glb"}}}})  # fmt: skip
        if "animations" in path:
            return Resp({"status": "SUCCEEDED", "consumed_credits": 30, "result": {"animation_glb_url": f"https://cdn/{task}/clips.glb"}})
        return Resp({"status": "SUCCEEDED", "consumed_credits": 10, "model_urls": {"glb": f"https://cdn/{task}/model.glb"}})


def test_a_character_is_modelled_rigged_and_animated_once(tmp_path):
    http = FakeHttp()
    meshy = Meshy(AssetStore(tmp_path), http, key="test-key")
    model = meshy.model("a giant with a wild black beard", "brown moleskin coat", character=True)
    assert http.posts[0][1]["mode"] == "preview" and http.posts[0][1]["pose_mode"] == "t-pose"
    assert http.posts[1][1] == {"mode": "refine", "preview_task_id": "t1", "texture_prompt": "brown moleskin coat", "target_formats": ["glb"]}
    assert (tmp_path / model.files["model"]).read_bytes().startswith(b"glTF") and model.credits == 20
    rig = meshy.rig(model, 3.5)
    assert http.posts[2] == ("/openapi/v1/rigging", {"input_task_id": "t2", "animation_type": "biped", "height_meters": 3.5, "skeleton_template": "mixamo"})
    assert set(rig.files) == {"rigged", "walking"}
    clips = meshy.clips(rig, list(range(12)))
    assert [p[1]["action_ids"] for p in http.posts[3:]] == [list(range(10)), [10, 11]] and len(clips.files) == 2
    # A second studio run pays for nothing.
    again = FakeHttp()
    m2 = Meshy(AssetStore(tmp_path), again, key="test-key")
    m2.clips(m2.rig(m2.model("a giant with a wild black beard", "brown moleskin coat", True), 3.5), list(range(12)))
    assert again.posts == []


def test_a_failed_task_is_an_error_and_the_library_is_cached(tmp_path):
    meshy = Meshy(AssetStore(tmp_path), FakeHttp(fail="rigging"), key="test-key")
    with pytest.raises(MeshyError, match="pose estimation failed"):
        meshy.rig(meshy.model("a chair", "oak", character=False), 1.0)
    assert meshy.library()[0]["name"] == "Idle" and (tmp_path / "animation-library.json").exists()
