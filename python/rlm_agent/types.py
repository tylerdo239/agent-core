"""Small, JSON-friendly contracts shared by the RLM data-agent modules."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


EventType = Literal[
    "turn_started",
    "iteration_started",
    "iteration_completed",
    "analysis",
    "code",
    "observation",
    "subcall_started",
    "subcall_completed",
    "subcall_result",
    "context_usage",
    "memory_updated",
    "human_decision",
    "final_answer",
    "error",
]


@dataclass(frozen=True)
class AgentEvent:
    type: EventType
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, **self.data}


@dataclass(frozen=True)
class ControlEvent:
    kind: Literal["ask_user", "action_approval"]
    question: str = ""
    options: tuple[str, ...] = ()
    action: str = ""
    reason: str = ""
    request_id: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["options"] = list(self.options)
        return payload


@dataclass(frozen=True)
class ContextSnapshot:
    session_id: str
    context_index: int
    payload: dict[str, Any]


@dataclass
class PendingNotebookAction:
    """A root-RLM cell paused immediately before sensitive execution."""

    code: str
    model_response: str
    message_history: list[dict[str, Any]]
    iteration_number: int


@dataclass(frozen=True)
class AgentTurnResult:
    status: Literal["completed", "waiting_user", "waiting_approval", "failed"]
    answer: str = ""
    control: ControlEvent | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    execution_time: float = 0.0
    trace_path: str | None = None
