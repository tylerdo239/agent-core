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

# ---- G2/G3 helpers (DeepAnalyze-inspired) ----

def _classify_format_gate(events: list[dict[str, Any]], result: dict[str, Any]) -> dict[str, Any]:
    """G3: distinguish protocol vs capability failures."""
    has_code = any(event.get("type") == "code" for event in events)
    has_iteration = any(event.get("type") == "iteration_completed" for event in events)
    has_error = any(event.get("type") == "error" for event in events)
    answer = str(result.get("content") or "").strip()
    status = str(result.get("status") or "")
    if has_error and not has_code:
        return {"gate": "protocol_error", "reason": "error_without_code", "detail": "turn emitted error before any code block"}
    if not has_code and has_iteration:
        # Model issued iterations but never produced a code block (plain text / JSON-only)
        if answer:
            return {"gate": "protocol_no_fence", "reason": "no_repl_fence", "detail": "iterations present but no code event — likely plain text without ```repl"}
        return {"gate": "protocol_no_fence", "reason": "empty_turn", "detail": "no code event and no answer"}
    if not has_code and not has_iteration and answer:
        # Direct path may submit in first block which still counts as code; this branch is rare
        return {"gate": "ok", "reason": "direct_answer", "detail": "no explicit iteration event but answer present"}
    if not has_code and not has_iteration and not answer:
        return {"gate": "protocol_stalled", "reason": "no_progress", "detail": "no code and no answer — stalled"}
    if status != "completed" and not has_error:
        return {"gate": "capability_error", "reason": f"status_{status}", "detail": f"turn status {status!r} without error event"}
    return {"gate": "ok", "reason": "ok", "detail": ""}


def _compute_s_interaction(events: list[dict[str, Any]], checks: dict[str, Any]) -> dict[str, Any]:
    """G2: DeepAnalyze S_interaction analog — trajectory quality 0..1."""
    iterations = sum(1 for e in events if e.get("type") == "iteration_completed")
    observations = [e for e in events if e.get("type") == "observation"]
    code_events = [e for e in events if e.get("type") == "code"]
    error_events = [e for e in events if e.get("type") == "error"]
    # successful iterations = observations with success==True and empty stderr
    successful = sum(1 for e in observations if e.get("success") and not str(e.get("stderr") or "").strip())
    # failed = observations with success==False or stderr present
    failed = len(observations) - successful
    # repeated code detection (exact duplicate code blocks)
    code_strings = [str(e.get("code") or "").strip() for e in code_events if str(e.get("code") or "").strip()]
    seen: dict[str, int] = {}
    repeated = 0
    for c in code_strings:
        if c in seen:
            repeated += 1
        seen[c] = seen.get(c, 0) + 1
    unique_ratio = len(seen) / max(1, len(code_strings))
    # profile_dataset usage (G1 <Understand> primitive)
    used_profile = any("profile_dataset" in c for c in code_strings)
    uses_dataset = bool(checks.get("_has_dataset") or "dataset" in json.dumps(checks).lower() or any("dataset" in c.lower() or "load_dataset" in c for c in code_strings))
    # Success ratio
    success_ratio = (successful / max(1, iterations)) if iterations else 1.0
    # Waste penalty: repeated + extra iterations beyond budget
    waste_penalty = repeated / max(1, len(code_strings)) if code_strings else 0.0
    # Efficiency: how close to minimal iterations (assume optimal ~1-2 for many tasks)
    # We do not penalize heavily — just blend with success_ratio
    s_interaction = max(0.0, min(1.0, success_ratio * 0.6 + unique_ratio * 0.2 + (1.0 - waste_penalty) * 0.2))
    # If no iterations at all, S=0 unless direct path succeeded
    if iterations == 0 and not successful:
        s_interaction = 0.0
    # Flag for dataset tasks where profile_dataset was NOT used (DeepAnalyze -7.1 ablation)
    missing_understand = uses_dataset and not used_profile and iterations > 0
    return {
        "iterations": iterations,
        "successful_iterations": successful,
        "failed_iterations": failed,
        "code_blocks": len(code_strings),
        "repeated_code_blocks": repeated,
        "unique_code_ratio": round(unique_ratio, 3),
        "used_profile_dataset": used_profile,
        "missing_understand": missing_understand,
        "s_interaction": round(s_interaction, 3),
        "success_ratio": round(success_ratio, 3),
        "error_events": len(error_events),
    }

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


def upload_fixture(base_url: str, api_key: str, session_id: str, source: Path) -> None:
    """Put a benchmark fixture in the real workspace through the public API.

    Do not copy directly into data/: production uses a Docker named volume, so
    a host-side copy creates a benchmark that passes setup but is invisible to
    the running agent.
    """
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/sessions/{session_id}/files",
        data=source.read_bytes(),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/octet-stream",
            "X-File-Name": source.name,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status not in (200, 201):
                raise RuntimeError(f"upload returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"upload {source.name!r} failed ({error.code}): {detail}") from error


def register_datasets(base_url: str, api_key: str, session_id: str, case: dict[str, Any]) -> list[str]:
    """Upload fixtures and let the configured workspace provider register them.

    This works unchanged for local workspaces, Docker volumes, and remote
    deployments because it exercises the same binary upload path as the UI.
    """
    wanted = case.get("datasets") or []
    if not wanted:
        return []
    problems: list[str] = []
    for name in wanted:
        source = find_fixture(name)
        if source is None:
            problems.append(f"fixture {name!r} not found under {FIXTURES}")
            continue
        try:
            upload_fixture(base_url, api_key, session_id, source)
        except RuntimeError as error:
            problems.append(str(error))
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
    # G2/G3 extensions (backward-compatible defaults)
    s_interaction: float = 0.0
    format_gate: str = "ok"
    format_reason: str = ""
    interaction: dict[str, Any] | None = None


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

    # ---- G4: report quality heuristics (open-ended) ----
    # report_keywords: each keyword must appear (case-insensitive)
    for kw in checks.get("report_keywords", []):
        if str(kw).casefold() not in folded:
            failures.append(f"report missing keyword {kw!r}")
    # report_sections: regex patterns that should appear (e.g. headings)
    for pattern in checks.get("report_sections", []):
        if not re.search(pattern, answer, re.IGNORECASE):
            failures.append(f"report missing section matching {pattern!r}")
    # min_words: report must be at least N words (analyst-grade reports need substance)
    if "min_words" in checks:
        word_count = len(answer.split())
        if word_count < int(checks["min_words"]):
            failures.append(f"report too short: {word_count} words < {checks['min_words']}")
    # Optional LLM-judge placeholder: if checks contains llm_judge_prompt, we defer to post-scoring (not failing here)
    # Caller (run_case) will fill judge result into interaction if needed.

    # ---- G2/G3: interaction & format metrics (DeepAnalyze-inspired) ----
    interaction = _compute_s_interaction(events, checks)
    gate_info = _classify_format_gate(events, result)
    # Expose missing Understand as non-blocking warning in interaction, not hard fail (yet).
    # To make it a soft signal for A/B, we add a warning failure only if explicitly requested.
    if checks.get("require_profile_dataset") and interaction.get("missing_understand"):
        failures.append("dataset task did not call profile_dataset() as first step (<Understand> missing)")

    return TurnScore(
        passed=not failures,
        failures=failures,
        answer=answer,
        iterations=iterations,
        tool_calls=tool_calls,
        duration_seconds=round(duration, 3),
        status=str(result.get("status") or "unknown"),
        context_peak_tokens=peak,
        s_interaction=float(interaction.get("s_interaction", 0.0)),
        format_gate=str(gate_info.get("gate", "ok")),
        format_reason=str(gate_info.get("reason", "")),
        interaction=interaction,
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
    setup_problems = register_datasets(base_url, api_key, session_id, case)

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
    # Aggregate G2/G3 metrics across all turns for A/B comparison
    all_turn_scores = [t["score"] for c in report["cases"] for t in c.get("turns", [])]
    avg_s = sum(s.get("s_interaction", 0) for s in all_turn_scores) / max(1, len(all_turn_scores))
    avg_iter = sum(s.get("iterations", 0) for s in all_turn_scores) / max(1, len(all_turn_scores))
    fmt_dist: dict[str, int] = {}
    for s in all_turn_scores:
        gate = s.get("format_gate", "ok")
        fmt_dist[gate] = fmt_dist.get(gate, 0) + 1
    # G1 adoption: how many dataset turns used profile_dataset
    profile_used = sum(1 for s in all_turn_scores if (s.get("interaction") or {}).get("used_profile_dataset"))
    profile_missing = sum(1 for s in all_turn_scores if (s.get("interaction") or {}).get("missing_understand"))
    report["summary"] = {
        "passed": passed,
        "total": len(report["cases"]),
        "score": passed / len(report["cases"]) if report["cases"] else 0,
        "avg_s_interaction": round(avg_s, 3),
        "avg_iterations": round(avg_iter, 2),
        "format_gate_dist": fmt_dist,
        "profile_dataset_used": profile_used,
        "profile_dataset_missing": profile_missing,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False), flush=True)
    print(f"REPORT {args.report}", flush=True)


if __name__ == "__main__":
    main()
