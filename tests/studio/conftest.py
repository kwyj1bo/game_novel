import json
from pathlib import Path

import pytest

from pipeline.text import load_chapters

FIX = Path(__file__).parent.parent / "pipeline" / "fixtures"


class FakeModel:
    """A scripted transport: `answers[task prefix]` is a list of answers, one per
    call (the last repeats). Records every prompt."""

    def __init__(self, answers: dict):
        self.answers = {k: list(v) for k, v in answers.items()}
        self.prompts: list[tuple[str, str]] = []

    def __call__(self, system, prompt, schema, effort):
        task = prompt.split(":\n", 1)[0]
        self.prompts.append((task, prompt))
        key = next(k for k in self.answers if task.startswith(k))
        queue = self.answers[key]
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        return json.loads(json.dumps(answer)), {"input_tokens": 100, "output_tokens": 10, "cost_usd": 0.01}


@pytest.fixture
def voyage():
    return load_chapters(FIX / "voyage.txt")
