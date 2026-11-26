"""One door to the language model for every agent in the studio.

- Structured output: every request carries a JSON schema and returns parsed JSON.
- Self-correction: a `check` function lists what is wrong with an answer; the
  errors go back to the model, which fixes its answer (up to `repairs` rounds).
- Cache: answers are stored by a hash of the request, so a rebuild is free
  and gives the same result.
- Ledger: every call records its time, tokens and cost, so a book's cost is known.

The model is reached through an API key (ANTHROPIC_API_KEY) or, without one,
through Claude Code signed in with a Claude subscription.
"""

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

MODEL = os.environ.get("STUDIO_MODEL", "claude-opus-5-5")


@dataclass
class Call:
    task: str
    seconds: float
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    cached: bool = False
    repairs: int = 0


@dataclass
class Ledger:
    calls: list[Call] = field(default_factory=list)

    def totals(self) -> dict:
        fresh = [c for c in self.calls if not c.cached]
        return {
            "calls": len(self.calls),
            "cached": len(self.calls) - len(fresh),
            "minutes": round(sum(c.seconds for c in fresh) / 60, 1),
            "input_tokens": sum(c.input_tokens for c in fresh),
            "output_tokens": sum(c.output_tokens for c in fresh),
            "cost_usd": round(sum(c.cost_usd for c in fresh), 2),
            "repairs": sum(c.repairs for c in self.calls),
        }


class ModelError(RuntimeError):
    pass


class Model:
    """Structured requests with cache, self-correction and a ledger.
    `transport(system, prompt, schema, effort) -> (answer, usage)` does the call;
    tests pass a fake one."""

    def __init__(self, transport=None, cache: Path | None = None):
        self.transport = transport or default_transport()
        self.cache_path = cache
        self.cache: dict = json.loads(cache.read_text()) if cache and cache.exists() else {}
        self.ledger = Ledger()

    def ask(self, system: str, task: str, items, schema: dict, effort: str = "medium", check=None, repairs: int = 2) -> dict:
        key = hashlib.sha256(json.dumps([MODEL, system, task, items, schema, effort], sort_keys=True).encode()).hexdigest()[:24]
        if key in self.cache:
            self.ledger.calls.append(Call(task, 0.0, cached=True))
            return self.cache[key]
        prompt = f"{task}:\n" + json.dumps(items, indent=1, ensure_ascii=False)
        answer, call = self._call(system, task, prompt, schema, effort)
        for _ in range(repairs):
            errors = check(answer) if check else []
            if not errors:
                break
            call.repairs += 1
            fix = (f"{prompt}\n\nYour previous answer:\n{json.dumps(answer, ensure_ascii=False)}\n\n"
                   "It has these problems. Answer again, in full, with them fixed:\n- " + "\n- ".join(errors[:30]))  # fmt: skip
            answer, more = self._call(system, task, fix, schema, effort)
            call.seconds += more.seconds
            call.input_tokens += more.input_tokens
            call.output_tokens += more.output_tokens
            call.cost_usd += more.cost_usd
        else:
            if check and (errors := check(answer)):
                raise ModelError(f"{task}: still invalid after {repairs} repairs: {errors[:5]}")
        self.cache[key] = answer
        self._save()
        return answer

    def _call(self, system, task, prompt, schema, effort) -> tuple[dict, Call]:
        started = time.time()
        answer, usage = self.transport(system, prompt, schema, effort)
        call = Call(task, time.time() - started, usage.get("input_tokens", 0), usage.get("output_tokens", 0), usage.get("cost_usd", 0.0))
        self.ledger.calls.append(call)
        if answer is None:
            raise ModelError(f"{task}: no answer")
        return answer, call

    def _save(self) -> None:
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False))


# ---- transports -----------------------------------------------------------------


def default_transport():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return api_transport()
    path = claude_code()
    if not path:
        raise ModelError("no model: set ANTHROPIC_API_KEY or sign in to Claude Code (claude auth login)")
    return cli_transport(path)


def claude_code() -> str | None:
    """A Claude Code executable: STUDIO_CLAUDE_BIN, `claude` on the PATH, or the
    copy inside the VS Code extension (newest first)."""
    if os.environ.get("STUDIO_CLAUDE_BIN"):
        return os.environ["STUDIO_CLAUDE_BIN"]
    if found := shutil.which("claude"):
        return found
    bundled = sorted(Path.home().glob(".vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude"))
    return str(bundled[-1]) if bundled else None


def cli_transport(path: str):
    def send(system: str, prompt: str, schema: dict, effort: str):
        args = [path, "-p", "--output-format", "json", "--json-schema", json.dumps(schema), "--system-prompt", system,
                "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands",
                "--model", MODEL, "--effort", effort]  # fmt: skip
        with tempfile.TemporaryDirectory() as cwd:
            r = subprocess.run(args, input=prompt, capture_output=True, text=True, timeout=3600, cwd=cwd)
        out = json.loads(r.stdout or "{}")
        if out.get("is_error") or r.returncode:
            raise ModelError(f"Claude Code: {out.get('result') or r.stderr.strip()[-300:]}")
        u = out.get("usage", {})
        usage = {"input_tokens": u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0),
                 "output_tokens": u.get("output_tokens", 0), "cost_usd": out.get("total_cost_usd", 0.0)}  # fmt: skip
        return out.get("structured_output"), usage

    return send


def api_transport():
    import anthropic

    client = anthropic.Anthropic()

    def send(system: str, prompt: str, schema: dict, effort: str):
        # Streamed, because a screenplay can be long; a refused request falls
        # back to another model on the server.
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=64000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            system=system,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            r = stream.get_final_message()
        usage = {"input_tokens": r.usage.input_tokens, "output_tokens": r.usage.output_tokens}
        if r.stop_reason in ("refusal", "max_tokens"):
            log.warning("model stopped: %s", r.stop_reason)
            return None, usage
        return json.loads(next(b.text for b in r.content if b.type == "text")), usage

    return send


def obj(props: dict) -> dict:
    """A strict JSON-schema object: every property required, nothing else allowed."""
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def arr(items: dict) -> dict:
    return {"type": "array", "items": items}


S, I, N, B = {"type": "string"}, {"type": "integer"}, {"type": "number"}, {"type": "boolean"}
