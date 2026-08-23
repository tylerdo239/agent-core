"""Deterministic approval policy for sensitive RLM actions."""

from __future__ import annotations

import ast
import re
import uuid
from dataclasses import dataclass

from .types import ControlEvent


SUB_LLM_CALLS = {
    "llm_query",
    "llm_query_batched",
    "rlm_query",
    "rlm_query_batched",
}
CONTROL_CALLS = {
    "ask_user",
}


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    message: str = ""
    control: ControlEvent | None = None
    blocked_code: str = ""


def _called_names(code: str) -> set[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name):
            names.add(node.func.id)
        elif isinstance(node.func, ast.Attribute):
            names.add(node.func.attr)
    return names


def _referenced_names(code: str) -> set[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
    return names


def _canonical_code(code: str) -> str:
    return re.sub(r"\s+", " ", str(code).strip())


def _call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


def _is_control_only(code: str) -> bool:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False
    if len(tree.body) != 1:
        return False
    statement = tree.body[0]
    return (
        isinstance(statement, ast.Expr)
        and isinstance(statement.value, ast.Call)
        and _call_name(statement.value) in CONTROL_CALLS
    )


def is_approval_response(value: str) -> bool:
    normalized = re.sub(r"[^a-z0-9à-ỹ]+", " ", str(value).casefold()).strip()
    denials = ("deny", "denied", "no", "không", "khong", "từ chối", "tu choi")
    if any(normalized == item or normalized.startswith(item + " ") for item in denials):
        return False
    approvals = (
        "approve",
        "approved",
        "approve once",
        "yes",
        "ok",
        "okay",
        "đồng ý",
        "dong y",
        "cho phép",
        "cho phep",
    )
    return normalized in approvals


class HumanControlPolicy:
    """Require one-shot permission for sub-LLM calls."""

    def __init__(self):
        self._action_grants: dict[str, int] = {}
        self._last_successful_code = ""

    def begin_task(self) -> None:
        self._action_grants.clear()
        self._last_successful_code = ""

    def apply_human_response(self, control: ControlEvent, response: str) -> bool:
        approved = is_approval_response(response)
        if control.kind == "action_approval" and approved and control.action:
            self._action_grants[control.action] = self._action_grants.get(control.action, 0) + 1
        return approved

    def evaluate(self, code_blocks: list[str]) -> PolicyDecision:
        calls_by_block = [
            (code, _called_names(code), _referenced_names(code)) for code in code_blocks
        ]

        sub_llm_blocks = [
            (code, sorted(references & SUB_LLM_CALLS))
            for code, _calls, references in calls_by_block
            if references & SUB_LLM_CALLS
        ]
        if sub_llm_blocks and not self._consume_grant("sub_llm"):
            code, methods = sub_llm_blocks[0]
            control = ControlEvent(
                kind="action_approval",
                question="Allow the agent to call a sub-LLM for this step?",
                options=("Approve once", "Deny"),
                action="sub_llm",
                reason=(
                    "The agent wants another model call. This can add latency, cost, "
                    "and model-generated information to the notebook trajectory."
                ),
                request_id=f"approval_{uuid.uuid4().hex[:12]}",
                details={
                    "methods": methods,
                    "code_preview": code[:2000],
                    "scope": "one notebook response",
                },
            )
            return PolicyDecision(
                allowed=False,
                message="Sub-LLM execution paused pending explicit human approval.",
                control=control,
                blocked_code=code,
            )

        for code, calls, _references in calls_by_block:
            if calls & CONTROL_CALLS and not _is_control_only(code):
                return PolicyDecision(
                    allowed=False,
                    message=(
                        "CONTROL_ONLY: A human-control request must be the only action in its "
                        "repl block. Submit the control request alone and wait for the response."
                    ),
                    blocked_code=code,
                )

        for code, calls, _references in calls_by_block:
            canonical = _canonical_code(code)
            if canonical and canonical == self._last_successful_code and not (calls & CONTROL_CALLS):
                return PolicyDecision(
                    allowed=False,
                    message=(
                        "NO_PROGRESS: This exact cell already completed successfully. Its REPL "
                        "output is present above. Choose a different action."
                    ),
                    blocked_code=code,
                )

        return PolicyDecision(allowed=True)

    def record_execution(self, code: str, stderr: str) -> None:
        if not str(stderr or "").strip():
            self._last_successful_code = _canonical_code(code)

    def reset(self) -> None:
        self.begin_task()

    def state(self) -> dict[str, object]:
        return {
            "approved_actions": sorted(
                action for action, uses in self._action_grants.items() if uses > 0
            ),
            "approval_scope": "one notebook response per sensitive action",
        }

    def _consume_grant(self, action: str) -> bool:
        remaining = self._action_grants.get(action, 0)
        if remaining <= 0:
            return False
        if remaining == 1:
            self._action_grants.pop(action, None)
        else:
            self._action_grants[action] = remaining - 1
        return True
