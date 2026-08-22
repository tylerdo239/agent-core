"""Translate RLM trajectory callbacks into typed events for API/UI consumers."""

from __future__ import annotations

import ast
import json
import queue
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator

from .types import AgentEvent


EventSink = Callable[[AgentEvent], None]


def truncate(value: Any, limit: int = 12_000) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    half = max(1, (limit - 64) // 2)
    return text[:half] + "\n...[RLM EVENT TRUNCATED]...\n" + text[-half:]


def summarize_iteration(iteration: Any) -> str:
    """Build an auditable action summary without exposing model scratchpad text."""
    blocks = list(getattr(iteration, "code_blocks", []) or [])
    if not blocks:
        return "Decision trace: no notebook action was proposed in this iteration."

    calls: list[str] = []
    context_names: list[str] = []
    for block in blocks:
        code = str(getattr(block, "code", "") or "")
        try:
            tree = ast.parse(code)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    name = node.func.attr
                else:
                    name = ""
                if name and name not in calls:
                    calls.append(name)
            elif isinstance(node, ast.Name):
                name = node.id
                if (name == "context" or name.startswith("context_")) and name not in context_names:
                    context_names.append(name)

    cell_label = "cell" if len(blocks) == 1 else "cells"
    lines = [f"Decision trace: proposed {len(blocks)} REPL {cell_label}."]
    if context_names:
        lines.append("Context accessed: " + ", ".join(context_names[:8]) + ".")
    if calls:
        suffix = ", ..." if len(calls) > 10 else ""
        lines.append("Functions used: " + ", ".join(calls[:10]) + suffix + ".")
    if any(getattr(getattr(block, "result", None), "final_answer", None) is not None for block in blocks):
        lines.append("This action submitted a final answer or human-control signal.")
    return "\n".join(lines)


def extract_analysis_text(response: Any, limit: int = 8_000) -> str:
    """Return the main-model prose that precedes its first executable block."""
    text = str(response or "")
    fence = re.search(r"```(?:repl|python)?\s*(?:\n|$)", text, flags=re.IGNORECASE)
    prose = text[:fence.start()] if fence else text
    prose = prose.strip()
    if prose.casefold() in {"repl", "python"}:
        prose = ""
    return truncate(prose, limit)


def _subcall_payload(call: Any, iteration: int, block: int, call_index: int) -> dict[str, Any]:
    usage = getattr(call, "usage_summary", None)
    return {
        "iteration": iteration,
        "block": block,
        "call": call_index,
        "call_type": str(getattr(call, "call_type", "sub_llm")),
        "model": str(getattr(call, "root_model", "unknown")),
        "prompt": getattr(call, "prompt", ""),
        "response": str(getattr(call, "response", "") or ""),
        "usage": usage.to_dict() if hasattr(usage, "to_dict") else {},
        "execution_time": getattr(call, "execution_time", None),
        "error": getattr(call, "error", None),
    }


class EventChannel:
    """Thread-safe bridge from the synchronous RLM runner to an SSE iterator."""

    _DONE = object()

    def __init__(self):
        self._queue: queue.Queue[AgentEvent | BaseException | object] = queue.Queue()

    def emit(self, event: AgentEvent) -> None:
        self._queue.put(event)

    def fail(self, error: BaseException) -> None:
        self._queue.put(error)
        self._queue.put(self._DONE)

    def close(self) -> None:
        self._queue.put(self._DONE)

    def __iter__(self) -> Iterator[AgentEvent]:
        while True:
            item = self._queue.get()
            if item is self._DONE:
                return
            if isinstance(item, BaseException):
                raise item
            if isinstance(item, AgentEvent):
                yield item


class TrajectoryEventLogger:
    """RLMLogger-compatible object that also emits code and observations live."""

    def __init__(self, log_dir: str | Path):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.log_file_path: str | None = None
        self._run_metadata: dict[str, Any] | None = None
        self._iterations: list[dict[str, Any]] = []
        self._iteration_count = 0
        self._sink: EventSink | None = None
        self._lock = threading.Lock()

    def start_turn(
        self,
        run_id: str,
        sink: EventSink,
        *,
        iteration_offset: int = 0,
    ) -> None:
        with self._lock:
            # Clearing a workspace can remove rlm_logs after this logger was
            # constructed. Recreate it for every turn so the next request is
            # independent of that lifecycle ordering.
            self.log_dir.mkdir(parents=True, exist_ok=True)
            self._sink = sink
            self._iterations = []
            self._iteration_count = max(0, int(iteration_offset))
            self.log_file_path = str(self.log_dir / f"{run_id}.jsonl")

    def finish_turn(self) -> None:
        with self._lock:
            self._sink = None

    def log_metadata(self, metadata: Any) -> None:
        value = metadata.to_dict() if hasattr(metadata, "to_dict") else dict(metadata)
        self._run_metadata = value
        self._write({"type": "metadata", "timestamp": datetime.now().isoformat(), **value})

    def clear_iterations(self) -> None:
        self._iterations = []
        self._iteration_count = 0

    def log(self, iteration: Any) -> None:
        self._iteration_count += 1
        serialized = iteration.to_dict() if hasattr(iteration, "to_dict") else {}
        entry = {
            "type": "iteration",
            "iteration": self._iteration_count,
            "timestamp": datetime.now().isoformat(),
            **serialized,
        }
        self._iterations.append(entry)
        self._write(entry)

        blocks = list(getattr(iteration, "code_blocks", []) or [])
        # The iteration-budget fallback is already emitted as final_answer by
        # the agent. Emitting its plain response as analysis as well made the
        # UI render the same text twice.
        is_plain_fallback = (
            getattr(iteration, "final_answer", None) is not None and not blocks
        )
        if not is_plain_fallback:
            response = extract_analysis_text(getattr(iteration, "response", ""))
            self._emit(AgentEvent("analysis", {
                "iteration": self._iteration_count,
                "content": response,
                "decision_summary": summarize_iteration(iteration),
            }))

        for block_index, block in enumerate(getattr(iteration, "code_blocks", []), start=1):
            code = str(getattr(block, "code", ""))
            self._emit(AgentEvent("code", {
                "iteration": self._iteration_count,
                "block": block_index,
                "code": code,
            }))
            result = getattr(block, "result", None)
            if result is None:
                continue
            for call_index, call in enumerate(
                getattr(result, "rlm_calls", []) or [], start=1
            ):
                self._emit(AgentEvent(
                    "subcall_result",
                    _subcall_payload(
                        call,
                        iteration=self._iteration_count,
                        block=block_index,
                        call_index=call_index,
                    ),
                ))
            stdout = truncate(getattr(result, "stdout", ""))
            stderr = truncate(getattr(result, "stderr", ""))
            self._emit(AgentEvent("observation", {
                "iteration": self._iteration_count,
                "block": block_index,
                "stdout": stdout,
                "stderr": stderr,
                "success": not bool(stderr),
            }))

    def get_trajectory(self) -> dict[str, Any] | None:
        if self._run_metadata is None:
            return None
        return {
            "run_metadata": self._run_metadata,
            "iterations": list(self._iterations),
        }

    @property
    def iteration_count(self) -> int:
        return self._iteration_count

    def emit(self, event: AgentEvent) -> None:
        """Emit a runtime lifecycle event to the active turn, if any."""
        self._emit(event)

    def _emit(self, event: AgentEvent) -> None:
        sink = self._sink
        if sink is not None:
            sink(event)

    def _write(self, entry: dict[str, Any]) -> None:
        path = self.log_file_path
        if not path:
            return
        log_path = Path(path)
        # Workspace reset deletes the whole workspace directory. It may happen
        # after start_turn() created rlm_logs but before RLM writes its first
        # metadata/iteration entry. Recreate the parent at the actual write
        # boundary; retry once for the narrow delete-between-mkdir-and-open race.
        for attempt in range(2):
            try:
                log_path.parent.mkdir(parents=True, exist_ok=True)
                with log_path.open("a", encoding="utf-8") as handle:
                    json.dump(entry, handle, ensure_ascii=False)
                    handle.write("\n")
                return
            except FileNotFoundError:
                if attempt == 1:
                    raise
