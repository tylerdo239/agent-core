"""Harness error taxonomy — Python mirror của src/errors.ts.

Mã phải KHỚP 1-1 với TS side để event/error lưu thông qua worker bridge vẫn
máy đọc được ở cả hai tầng. Feedback text ở đây được đưa NGAY VÀO observation
stream của model (in-band) thay vì chỉ log ra UI.
"""

CODE_PARSE = "CODE_PARSE"
NO_PROGRESS = "NO_PROGRESS"
TOOL_ARGS = "TOOL_ARGS"
TOOL_EXEC = "TOOL_EXEC"
TOOL_NOT_FOUND = "TOOL_NOT_FOUND"
SKILL_MISSING = "SKILL_MISSING"
SKILL_READ = "SKILL_READ"
CODE_RUNTIME = "CODE_RUNTIME"
LLM_PROVIDER = "LLM_PROVIDER"
CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW"
CONTRACT = "CONTRACT"
WORKER = "WORKER"
STATE_CORRUPT = "STATE_CORRUPT"
HUMAN_DENIED = "HUMAN_DENIED"
CANCELLED = "CANCELLED"
TIMEOUT = "TIMEOUT"

_TAXONOMY = {
    "CODE_PARSE": (
        "Your previous response was not executable: it had no fenced ```repl block "
        "(or wrapped actions in JSON/prose).",
        "Emit exactly one concise intent sentence followed by one fenced ```repl block "
        "containing Python. The block itself IS the action.",
    ),
    "NO_PROGRESS": (
        "The previous iteration made no progress.",
        "Change approach explicitly or submit the best supported partial answer now.",
    ),
    "CODE_RUNTIME": (
        "The executed Python cell raised an exception.",
        "Read the traceback, fix the specific cause, and rerun a corrected cell.",
    ),
    "STATE_CORRUPT": (
        "Session runtime state was corrupted by an illegal write to immutable input.",
        "Recreate required variables from context payloads; never write into context/context_N.",
    ),
}

_VALID_CODES = set(_TAXONOMY)


def in_band_feedback(code: str, detail: str | None = None) -> str:
    """Dòng [HARNESS ERROR ...] chèn vào stdout của một synthetic code block."""
    summary, guidance = _TAXONOMY.get(code, _TAXONOMY["NO_PROGRESS"])
    lines = [f"[HARNESS ERROR {code}] {summary}", f"ACTION REQUIRED: {guidance}"]
    if detail:
        lines.append(f"DETAIL: {detail}")
    return "\n".join(lines)


def classify(message: str) -> str:
    """Phân loại message lỗi tự do thành mã taxonomy (mirror classifyError TS)."""
    import re

    m = str(message or "")
    if re.search(r"ENOENT|worker (crashed|died|unreachable)|broker shut", m, re.I):
        return WORKER
    if re.search(r"contract|schema.*violat", m, re.I):
        return CONTRACT
    # str(KeyError('x')) === "'x'" — repr chuỗi trích đơn là dấu hiệu đặc trưng.
    if re.search(r"^'[^'\n]+'$|Traceback|ZeroDivision|NameError|AttributeError|SyntaxError|(KeyError|TypeError)\b", m):
        return CODE_RUNTIME
    if m.strip() in _VALID_CODES:
        return m.strip()
    if re.search(r"timeout|timed out", m, re.I):
        return TIMEOUT
    if re.search(r"cancel|abort", m, re.I):
        return CANCELLED
    return NO_PROGRESS
