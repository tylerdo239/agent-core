#!/usr/bin/env python3
"""Run a small, auditable RLM benchmark through agent-core's public REST API."""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CASES = Path(__file__).with_name("cases.json")
DEFAULT_REPORT = ROOT / "reports" / "rlm-benchmark" / "latest.json"
FIXTURES = Path(__file__).with_name("fixtures")


def find_fixture(name: str) -> Path | None:
    """Locate a fixture by name across the fixtures/ tree (flat or per-suite
    subdirectories such as dabench/ and synth/)."""
    direct = FIXTURES / name
    if direct.is_file():
        return direct
    for subdir in sorted(FIXTURES.iterdir()):
        candidate = subdir / name
        if candidate.is_file():
            return candidate
    return None
INTERNAL_LANGUAGE = re.compile(
    r"\b(?:context_\d+|history_\d+|REPL protocol|system prompt)\b",
    re.IGNORECASE,
)
NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")

# Session workspaces live under one of these layouts depending on the sandbox
# provider (local bind mount vs. named volume translated by the docker shim);
# see workspace_candidates().


# Session workspaces live under one of these layouts depending on the sandbox
# provider (local bind mount vs. named volume translated by the docker shim).
# The runtime also resolves some paths against the bare session-id folder, so
# fixtures are registered in every candidate location.
def workspace_candidates(session_id: str) -> list[Path]:
    return [
        ROOT / "data" / "rlm-workspaces" / session_id,
        ROOT / "data" / "rlm-volumes" / f"agent-core-rlm-workspace-{session_id}",
        ROOT / "data" / "rlm-volumes" / session_id,
    ]


def register_datasets(session_id: str, case: dict[str, Any]) -> list[str]:
    """Copy case fixtures into every candidate session-workspace location and
    register them in index.json so the agent's list_datasets()/load_dataset()
    helpers see them regardless of sandbox provider layout. Returns
    human-readable setup problems (empty list means success)."""
    wanted = case.get("datasets") or []
    if not wanted:
        return []
    targets = [path for path in workspace_candidates(session_id) if path.is_dir()]
    if not targets:
        # The provider creates the workspace lazily on first use; pre-create
        # every candidate layout so the right one is populated either way.
        for candidate in workspace_candidates(session_id):
            candidate.mkdir(parents=True, exist_ok=True)
            targets.append(candidate)
    problems: list[str] = []
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for name in wanted:
        source = find_fixture(name)
        if source is None:
            problems.append(f"fixture {name!r} not found under {FIXTURES}")
            continue
        payload = source.read_bytes()
        entry = {"filename": name, "path": name, "created_at": stamp}
        for workspace in targets:
            (workspace / name).write_bytes(payload)
            index_path = workspace / "index.json"
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
                if not isinstance(index, dict):
                    index = {}
            except (OSError, ValueError):
                index = {}
            index[source.stem] = entry
            index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
    return problems


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def request_json(
    base_url: str,
    api_key: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 360,
) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed ({error.code}): {detail}") from error


@dataclass
class TurnScore:
    passed: bool
    failures: list[str]
    answer: str
    iterations: int
    tool_calls: list[str]
    duration_seconds: float
    status: str
    context_peak_tokens: int = 0


def score_turn(
    result: dict[str, Any],
    events: list[dict[str, Any]],
    checks: dict[str, Any],
    duration: float,
) -> TurnScore:
    answer = str(result.get("content") or "")
    folded = answer.casefold()
    tool_calls = [
        str(event.get("name"))
        for event in events
        if event.get("type") == "tool_call"
    ]
    iterations = sum(event.get("type") == "iteration_completed" for event in events)
    failures: list[str] = []

    expected = [str(value).casefold() for value in checks.get("answer_any", [])]
    if expected and not any(value in folded for value in expected):
        failures.append(f"answer contains none of {expected!r}")
    for pattern in checks.get("answer_regex", []):
        if not re.search(pattern, answer, re.IGNORECASE):
            failures.append(f"answer does not match regex {pattern!r}")
    for phrase in checks.get("answer_not", []):
        if str(phrase).casefold() in folded:
            failures.append(f"answer must not contain {phrase!r}")
    numbers = [float(value) for value in NUMBER_RE.findall(answer)]
    for spec in checks.get("numeric_answers", []):
        target = float(spec["value"])
        tolerance = float(spec.get("tolerance", 0.01))
        if not any(abs(number - target) <= tolerance for number in numbers):
            failures.append(
                f"no number within {tolerance} of {target} (found {numbers[:8]})"
            )
    max_context = checks.get("max_context_tokens")
    peak = max(
        (int(event.get("estimated_tokens") or 0) for event in events
         if event.get("type") == "context_usage"),
        default=0,
    )
    if max_context and peak > int(max_context):
        failures.append(f"context peaked at {peak} tokens (limit {max_context})")
    for name in checks.get("required_tools", []):
        if name not in tool_calls:
            failures.append(f"required tool {name!r} was not called")
    for name in checks.get("forbidden_tools", []):
        if name in tool_calls:
            failures.append(f"forbidden tool {name!r} was called")
    if iterations > int(checks.get("max_iterations", iterations)):
        failures.append(
            f"iterations {iterations} exceeded {checks['max_iterations']}"
        )
    if len(tool_calls) > int(checks.get("max_tool_calls", len(tool_calls))):
        failures.append(
            f"tool calls {len(tool_calls)} exceeded {checks['max_tool_calls']}"
        )
    if result.get("status") != "completed":
        failures.append(f"turn status is {result.get('status')!r}")
    if INTERNAL_LANGUAGE.search(answer):
        failures.append("final answer leaked internal protocol language")
    if any(event.get("type") == "error" for event in events):
        failures.append("turn emitted an error event")

    return TurnScore(
        passed=not failures,
        failures=failures,
        answer=answer,
        iterations=iterations,
        tool_calls=tool_calls,
        duration_seconds=round(duration, 3),
        status=str(result.get("status") or "unknown"),
        context_peak_tokens=peak,
    )


def run_case(
    base_url: str,
    api_key: str,
    case: dict[str, Any],
) -> dict[str, Any]:
    session = request_json(
        base_url,
        api_key,
        "POST",
        "/sessions",
        {"driver": "rlm", "maxSteps": 8},
    )
    session_id = session["id"]
    event_offset = 0
    turn_reports = []
    setup_problems = register_datasets(session_id, case)

    for turn in case["turns"]:
        started = time.perf_counter()
        payload: dict[str, Any] = {"message": turn["message"]}
        skill = turn.get("skill") or case.get("skill")
        if isinstance(skill, str) and skill:
            payload["selectedSkill"] = skill
        result = request_json(
            base_url,
            api_key,
            "POST",
            f"/sessions/{session_id}/messages",
            payload,
        )
        duration = time.perf_counter() - started
        all_events = request_json(
            base_url,
            api_key,
            "GET",
            f"/sessions/{session_id}/events",
        )["events"]
        new_events = all_events[event_offset:]
        event_offset = len(all_events)
        score = score_turn(result, new_events, turn.get("checks", {}), duration)
        if setup_problems:
            score.passed = False
            score.failures = [*setup_problems, *score.failures]
        turn_reports.append({
            "message": turn["message"],
            "score": asdict(score),
            "event_types": [event.get("type") for event in new_events],
        })

    return {
        "id": case["id"],
        "source": case.get("source"),
        "session_id": session_id,
        "passed": all(turn["score"]["passed"] for turn in turn_reports),
        "turns": turn_reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument("--only", action="append", default=[])
    args = parser.parse_args()

    env = load_env(ROOT / ".env")
    api_keys = [key.strip() for key in env.get("API_KEYS", "").split(",") if key.strip()]
    if not api_keys:
        raise RuntimeError("API_KEYS is missing from agent-core/.env")
    suite = json.loads(args.cases.read_text(encoding="utf-8"))
    selected = [
        case for case in suite["cases"]
        if not args.only or case["id"] in set(args.only)
    ]
    report = {
        "suite": suite["suite"],
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cases": [],
    }
    for case in selected:
        print(f"RUN {case['id']}", flush=True)
        case_report = run_case(args.base_url, api_keys[0], case)
        report["cases"].append(case_report)
        mark = "PASS" if case_report["passed"] else "FAIL"
        print(f"{mark} {case['id']}", flush=True)
    passed = sum(case["passed"] for case in report["cases"])
    report["summary"] = {
        "passed": passed,
        "total": len(report["cases"]),
        "score": passed / len(report["cases"]) if report["cases"] else 0,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False), flush=True)
    print(f"REPORT {args.report}", flush=True)


if __name__ == "__main__":
    main()
