"""Human-in-the-loop control envelope used inside the RLM final-answer channel."""

from __future__ import annotations

import json
from typing import Any, Literal, cast

from .types import ControlEvent


CONTROL_PREFIX = "__RLM_DATA_AGENT_CONTROL__:"


def encode_control(control: ControlEvent) -> str:
    return CONTROL_PREFIX + json.dumps(control.to_dict(), ensure_ascii=False)


def decode_control(value: str) -> ControlEvent | None:
    text = str(value or "").strip()
    if not text.startswith(CONTROL_PREFIX):
        return None

    try:
        payload: Any = json.loads(text[len(CONTROL_PREFIX):])
    except json.JSONDecodeError as exc:
        raise ValueError("RLM returned a malformed human-control envelope") from exc
    if not isinstance(payload, dict):
        raise ValueError("RLM human-control envelope must contain a JSON object")

    kind = str(payload.get("kind", "")).strip()
    if kind not in {"ask_user", "action_approval"}:
        raise ValueError(f"Unknown RLM human-control kind: {kind!r}")

    question = str(payload.get("question", "")).strip()
    options = tuple(
        str(item).strip()
        for item in payload.get("options", [])
        if str(item).strip()
    )
    action = str(payload.get("action", "")).strip()
    reason = str(payload.get("reason", "")).strip()
    request_id = str(payload.get("request_id", "")).strip()
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}

    if kind == "ask_user":
        if not question:
            raise ValueError("ask_user requires a question")
        if not 2 <= len(options) <= 4:
            raise ValueError("ask_user requires 2 to 4 options")
    elif kind == "action_approval":
        if not action or not question:
            raise ValueError("action_approval requires action and question")
        if not 2 <= len(options) <= 4:
            raise ValueError("action_approval requires 2 to 4 options")

    return ControlEvent(
        kind=cast(Literal["ask_user", "action_approval"], kind),
        question=question,
        options=options,
        action=action,
        reason=reason,
        request_id=request_id,
        details=details,
    )


def control_setup_code() -> str:
    """Return kernel bootstrap code for interactive user controls.

    These functions intentionally live inside the IPython namespace.  They can
    therefore signal completion through RLM's native ``answer`` object without
    pickling a host-process closure into the kernel.
    """

    prefix = repr(CONTROL_PREFIX)
    return f'''
import json as _rlm_control_json

def ask_user(question, options):
    """Pause this RLM turn and ask the human to choose one of 2-4 options."""
    _question = str(question).strip()
    _options = [str(item).strip() for item in options if str(item).strip()]
    _options = [item for item in _options if item.casefold() not in {{"other", "khác", "khac"}}]
    if not _question:
        raise ValueError("ask_user requires a non-empty question")
    if not 2 <= len(_options) <= 4:
        raise ValueError("ask_user requires 2 to 4 options; the UI adds Other")
    _payload = {{"kind": "ask_user", "question": _question, "options": _options}}
    answer["content"] = {prefix} + _rlm_control_json.dumps(_payload, ensure_ascii=False)
    answer["ready"] = True
    return _payload
'''.strip()
