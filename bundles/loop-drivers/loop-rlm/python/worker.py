"""JSON-lines process boundary for one persistent RLM session.

stdin is reserved for commands and stdout for protocol events. The imported
RLM stack is verbose, so all of its ordinary output is redirected to stderr.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import traceback
import uuid
from contextlib import redirect_stdout
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

_stdout_lock = threading.Lock()
_protocol_stdout = sys.stdout


def encode_event(
    protocol_request_id: str,
    event_type: str,
    **payload: Any,
) -> str:
    """Keep transport requestId distinct from payload-level request_id."""
    return json.dumps(
        {"requestId": protocol_request_id, "type": event_type, **payload},
        ensure_ascii=False,
        default=str,
    )


def emit(protocol_request_id: str, event_type: str, **payload: Any) -> None:
    with _stdout_lock:
        print(
            encode_event(protocol_request_id, event_type, **payload),
            file=_protocol_stdout,
            flush=True,
        )


def serializable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return value


DATA_AGENT_ROOT = Path(os.environ["RLM_DATA_AGENT_ROOT"]).resolve()
sys.path.insert(0, str(DATA_AGENT_ROOT))
vendor_rlm = DATA_AGENT_ROOT / "vendor" / "rlm"
if vendor_rlm.is_dir():
    sys.path.insert(0, str(vendor_rlm))

workspace_root = Path(os.environ["RLM_WORKSPACE_ROOT"]).resolve()
workspace_base = workspace_root.parent
# RLMDataAgent.__init__ luôn tạo workspace "default" trước khi turn đầu tiên
# cung cấp session id thật. Trong sandbox-docker chỉ workspace của session
# hiện tại được mount writable, nên bootstrap bên trong chính volume đó rồi
# chuyển ContextBuilder về base chuẩn ngay sau khi construct.
bootstrap_workspace_base = workspace_root / ".agent_bootstrap"
os.environ["DEEPANALYZE_WORKSPACE_BASE"] = str(bootstrap_workspace_base)
config = json.loads(os.environ.get("RLM_AGENT_CONFIG_JSON", "{}"))

with redirect_stdout(sys.stderr):
    import rlm.core.rlm as core_rlm_module
    import triadic_dgm.rlm_agent.agent as agent_module
    from triadic_dgm.rlm_agent.harness_adapter import HarnessRLM
    from rlm.clients.base_lm import BaseLM
    from rlm.core.types import ModelUsageSummary, UsageSummary


_host_call_lock = threading.Lock()
_active_request_id = ""
_active_session_id = ""


class HostLlmClient(BaseLM):
    """RLM client whose actual completion is provided by Cordis ``ctx.llm``."""

    def __init__(
        self,
        model_name: str | None = None,
        sampling_args: dict[str, Any] | None = None,
        **kwargs: Any,
    ):
        super().__init__(
            model_name=model_name or "default",
            sampling_args=sampling_args,
            **kwargs,
        )
        self._calls = 0
        self._input_tokens = 0
        self._output_tokens = 0
        self._cost = 0.0
        self._last = ModelUsageSummary(1, 0, 0)

    @staticmethod
    def _messages(prompt: Any) -> list[dict[str, str]]:
        if isinstance(prompt, str):
            return [{"role": "user", "content": prompt}]
        if isinstance(prompt, list):
            return [
                {
                    "role": str(item.get("role") or "user"),
                    "content": str(item.get("content") or ""),
                }
                for item in prompt
                if isinstance(item, dict)
            ]
        return [{"role": "user", "content": json.dumps(prompt, default=str)}]

    def completion(self, prompt: Any, model: str | None = None) -> str:
        call_id = uuid.uuid4().hex
        max_tokens = self.sampling_args.get("max_tokens")
        purpose = "memory" if max_tokens and int(max_tokens) <= 1200 else "root"
        if max_tokens and int(max_tokens) > 2048:
            purpose = "sub"
        with _host_call_lock:
            emit(
                _active_request_id,
                "__host_llm__",
                callId=call_id,
                messages=self._messages(prompt),
                model=model or self.model_name,
                temperature=self.sampling_args.get("temperature"),
                max_tokens=max_tokens,
                extra_body=self.sampling_args.get("extra_body") or {},
                purpose=purpose,
            )
            response_line = sys.stdin.readline()
            if not response_line:
                raise RuntimeError("host LLM bridge closed")
            response = json.loads(response_line)
            payload = dict(response.get("payload") or {})
            if payload.get("callId") != call_id:
                raise RuntimeError("host LLM bridge returned a mismatched call id")
            if payload.get("error"):
                raise RuntimeError(str(payload["error"]))
        usage = dict(payload.get("usage") or {})
        input_tokens = int(usage.get("inputTokens") or 0)
        output_tokens = int(usage.get("outputTokens") or 0)
        cost = usage.get("cost")
        self._last = ModelUsageSummary(1, input_tokens, output_tokens, cost)
        self._calls += 1
        self._input_tokens += input_tokens
        self._output_tokens += output_tokens
        if cost is not None:
            self._cost += float(cost)
        if os.environ.get("RLM_DEBUG_LM_DUMP"):
            with redirect_stdout(sys.stderr):
                print(f"[lm-dump] purpose={purpose} prompt_tail={str(prompt)[-500:]!r} response={payload.get('content')!r}")
        return str(payload.get("content") or "")

    async def acompletion(self, prompt: Any, model: str | None = None) -> str:
        return self.completion(prompt, model=model)

    def get_usage_summary(self) -> UsageSummary:
        usage = ModelUsageSummary(
            self._calls,
            self._input_tokens,
            self._output_tokens,
            self._cost or None,
        )
        return UsageSummary(model_usage_summaries={self.model_name: usage})

    def get_last_usage(self) -> ModelUsageSummary:
        return self._last


def host_get_client(_backend: Any, backend_kwargs: dict[str, Any]) -> HostLlmClient:
    return HostLlmClient(**dict(backend_kwargs or {}))


def host_tool_call(name: str, args: dict[str, Any]) -> Any:
    call_id = uuid.uuid4().hex
    with _host_call_lock:
        emit(
            _active_request_id,
            "__host_tool__",
            callId=call_id,
            name=name,
            args=args,
            sessionId=_active_session_id,
        )
        response_line = sys.stdin.readline()
        if not response_line:
            raise RuntimeError("host tool bridge closed")
        response = json.loads(response_line)
        response_payload = dict(response.get("payload") or {})
        if response_payload.get("callId") != call_id:
            raise RuntimeError("host tool bridge returned a mismatched call id")
        if response_payload.get("error"):
            raise RuntimeError(str(response_payload["error"]))
        return response_payload.get("result")


def host_skill_read(skill_name: str, resource_path: str) -> Any:
    call_id = uuid.uuid4().hex
    with _host_call_lock:
        emit(
            _active_request_id,
            "__host_skill__",
            callId=call_id,
            skill=skill_name,
            path=resource_path,
            sessionId=_active_session_id,
        )
        response_line = sys.stdin.readline()
        if not response_line:
            raise RuntimeError("host skill bridge closed")
        response = json.loads(response_line)
        response_payload = dict(response.get("payload") or {})
        if response_payload.get("callId") != call_id:
            raise RuntimeError("host skill bridge returned a mismatched call id")
        if response_payload.get("error"):
            raise RuntimeError(str(response_payload["error"]))
        return response_payload.get("result")


# Both modules imported get_client by value, so patch the two call sites used
# by RLMDataAgent and inherited child/subcall paths.
agent_module.get_client = host_get_client
core_rlm_module.get_client = host_get_client
agent: HarnessRLM | None = None


def shutdown(_signum: int, _frame: Any) -> None:
    if agent is not None:
        with redirect_stdout(sys.stderr):
            agent.close()
    raise SystemExit(0)


signal.signal(signal.SIGTERM, shutdown)


def get_agent() -> HarnessRLM:
    global agent
    if agent is None:
        cache = workspace_root / ".agent_cache"
        cache.mkdir(parents=True, exist_ok=True)
        with redirect_stdout(sys.stderr):
            agent = HarnessRLM(
                config,
                cache,
                host_tool_call=host_tool_call,
                host_skill_read=host_skill_read,
            )
        agent.context_builder.workspace_base = workspace_base
        os.environ["DEEPANALYZE_WORKSPACE_BASE"] = str(workspace_base)
    return agent


def handle(request_id: str, operation: str, payload: dict[str, Any]) -> None:
    global _active_request_id, _active_session_id
    _active_request_id = request_id
    _active_session_id = str(payload.get("sessionId") or workspace_root.name)
    runtime = get_agent()
    if operation == "inspect_workspace":
        session_id = str(payload.get("sessionId") or workspace_root.name)
        with redirect_stdout(sys.stderr):
            snapshot = runtime.context_builder.inspect_workspace(session_id)
        emit(request_id, "__result__", **snapshot)
        return
    if operation == "write_workspace_file":
        import base64

        filename = str(payload.get("filename") or "").strip().replace("/", "_") or "upload"
        b64 = str(payload.get("content") or "")
        raw = base64.b64decode(b64) if b64 else b""
        # Route through agent workspace so index.json stays consistent
        session_id = str(payload.get("sessionId") or _active_session_id)
        root = runtime.context_builder.workspace_root(session_id)
        target = root / filename
        target.write_bytes(raw)
        # Register tabular files in the session index
        if target.suffix.lower() in {".csv", ".tsv", ".xlsx", ".xls", ".parquet"}:
            index_path = root / "index.json"
            try:
                index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
                if not isinstance(index, dict):
                    index = {}
            except Exception:
                index = {}
            index[target.stem] = {"filename": filename, "path": filename, "created_at": __import__("datetime").datetime.now().isoformat()}
            index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
        emit(request_id, "__result__", path=filename, size=len(raw))
        return
    if operation == "read_workspace_file":
        import base64

        file_path = str(payload.get("path") or payload.get("filename") or "")
        session_id = str(payload.get("sessionId") or _active_session_id)
        root = runtime.context_builder.workspace_root(session_id)
        resolved = (root / file_path).resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError("path escapes workspace")
        emit(request_id, "__result__", content=base64.b64encode(resolved.read_bytes()).decode())
        return
    if operation == "list_workspace_files":
        session_id = str(payload.get("sessionId") or _active_session_id)
        root = runtime.context_builder.workspace_root(session_id)
        files: list[dict] = []
        for entry in root.rglob("*"):
            if entry.is_file() and entry.name != "index.json" and "rlm_logs" not in entry.parts and ".agent" not in entry.name:
                try:
                    st = entry.stat()
                    files.append({"path": str(entry.relative_to(root)), "size": st.st_size, "mtime": __import__("datetime").datetime.fromtimestamp(st.st_mtime).isoformat()})
                except OSError:
                    continue
            if len(files) >= 100:
                break
        files.sort(key=lambda f: f["path"])
        emit(request_id, "__result__", files=files)
        return
    if operation == "prepared_turn":
        previous_result = runtime.last_turn_result
        with redirect_stdout(sys.stderr):
            for event in runtime.stream_prepared_turn(payload):
                value = event.to_dict()
                emit(request_id, str(value.pop("type")), **value)
        result = runtime.last_turn_result
        if result is None or result is previous_result:
            result_payload = {
                "status": "failed",
                "answer": "RLM turn ended without a result",
            }
        else:
            result_payload = serializable(result)
            if result_payload.get("control") is not None:
                result_payload["control"] = serializable(result.control)
            result_payload["memory"] = runtime.last_turn_memory or {}
        emit(request_id, "__result__", **result_payload)
        return
    if operation == "execute":
        with redirect_stdout(sys.stderr):
            result = runtime.execute_code(str(payload.get("code") or ""))
        emit(request_id, "execution_result", result=serializable(result))
        return
    if operation == "reset":
        with redirect_stdout(sys.stderr):
            runtime.clear()
        emit(request_id, "reset_completed")
        return
    if operation == "clear_workspace":
        with redirect_stdout(sys.stderr):
            runtime.clear_workspace_state()
        emit(request_id, "workspace_cleared")
        return
    raise ValueError(f"unsupported worker operation: {operation}")


print(json.dumps({"type": "__ready__"}), flush=True)
for line in sys.stdin:
    request_id = ""
    try:
        message = json.loads(line)
        request_id = str(message.get("requestId") or "")
        handle(
            request_id,
            str(message.get("operation") or ""),
            dict(message.get("payload") or {}),
        )
    except BaseException as exc:
        traceback.print_exc(file=sys.stderr)
        emit(request_id, "error", message=str(exc))
        emit(request_id, "__result__", status="failed", answer=str(exc))
    finally:
        emit(request_id, "__done__")

if agent is not None:
    with redirect_stdout(sys.stderr):
        agent.close()
