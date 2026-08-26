"""Generate the bootstrap code installed in the persistent IPython notebook."""

from __future__ import annotations

from pathlib import Path

from .controls import control_setup_code


def build_notebook_setup_code(
    workspace_root: str | Path,
    repo_root: str | Path,
    runtime_session_id: str | None = None,
) -> str:
    workspace = str(Path(workspace_root).resolve())
    repo = str(Path(repo_root).resolve())
    safe_session = "".join(
        ch for ch in str(runtime_session_id or "") if ch.isalnum() or ch in "._-"
    ).strip(".-")
    return f'''
import json
import os
import sys
from pathlib import Path as _RLMPath

_ACTIVE_WORKSPACE_ROOT = {workspace!r}
_ACTIVE_SESSION_ID = {safe_session!r}
_RLM_REPO_ROOT = {repo!r}
_DATASET_CACHE = {{}}

if _RLM_REPO_ROOT not in sys.path:
    sys.path.insert(0, _RLM_REPO_ROOT)

def _workspace_path(relative_path=""):
    _root = _RLMPath(_ACTIVE_WORKSPACE_ROOT).resolve()
    _target = (_root / str(relative_path or "")).resolve()
    if _target != _root and _root not in _target.parents:
        raise ValueError("Path escapes the active workspace")
    return _target

def _session_path(relative_path=""):
    """Resolve a private path for this conversation inside the project workspace."""
    _root = _workspace_path()
    _session_root = (_root / ".sessions" / _ACTIVE_SESSION_ID).resolve() if _ACTIVE_SESSION_ID else _root
    _session_root.mkdir(parents=True, exist_ok=True)
    _target = (_session_root / str(relative_path or "")).resolve()
    if _target != _session_root and _session_root not in _target.parents:
        raise ValueError("Path escapes the active session")
    return _target

def _visible_path(relative_path=""):
    """Map the model-visible generated/ alias to this conversation's drafts."""
    _relative = _RLMPath(str(relative_path or ""))
    if _ACTIVE_SESSION_ID and _relative.parts and _relative.parts[0] == "generated":
        _draft = _session_path(_relative)
        if _draft.exists():
            return _draft
    return _workspace_path(_relative)

def _workspace_index():
    _path = _workspace_path("index.json")
    if not _path.exists():
        return {{}}
    with _path.open("r", encoding="utf-8") as _handle:
        _value = json.load(_handle)
    return _value if isinstance(_value, dict) else {{}}

def list_datasets():
    """Return registered tabular datasets in newest-first order."""
    _exts = {{".csv", ".tsv", ".xlsx", ".xls", ".parquet"}}
    _items = []
    for _file_id, _entry in _workspace_index().items():
        _name = _entry.get("filename") or _entry.get("path") or _file_id
        if _RLMPath(str(_name)).suffix.lower() not in _exts:
            continue
        _items.append({{
            "id": _file_id,
            "filename": _entry.get("filename") or _RLMPath(str(_entry.get("path", ""))).name,
            "path": _entry.get("path"),
            "created_at": _entry.get("created_at"),
        }})
    _items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return _items

def load_dataset(file_id=None):
    """Load a registered CSV/TSV/Excel/Parquet dataset into a pandas DataFrame."""
    import pandas as pd
    _index = _workspace_index()
    _datasets = list_datasets()
    if not _datasets:
        raise ValueError("No tabular dataset is registered in the active workspace")
    if file_id is None:
        _matched_id = _datasets[0]["id"]
    elif str(file_id) in _index:
        _matched_id = str(file_id)
    else:
        _search = str(file_id).strip().casefold()
        _matches = [
            item for item in _datasets
            if _search in str(item.get("filename") or "").casefold()
        ]
        if not _matches:
            raise ValueError(f"Dataset {{file_id!r}} not found; call list_datasets()")
        _matched_id = _matches[0]["id"]
    if _matched_id in _DATASET_CACHE:
        return _DATASET_CACHE[_matched_id]
    _entry = _index[_matched_id]
    _path = _workspace_path(_entry["path"])
    if not _path.exists():
        raise FileNotFoundError(str(_path))
    _ext = _path.suffix.lower()
    if _ext in {{".csv", ".tsv"}}:
        _separator = "\\t" if _ext == ".tsv" else ","
        _metadata_file = _entry.get("metadata_file")
        if _metadata_file:
            _metadata_path = _workspace_path(_metadata_file)
            if _metadata_path.exists():
                with _metadata_path.open("r", encoding="utf-8") as _handle:
                    _separator = json.load(_handle).get("separator") or _separator
        _frame = pd.read_csv(_path, sep=_separator, engine="python")
    elif _ext in {{".xlsx", ".xls"}}:
        _frame = pd.read_excel(_path)
    elif _ext == ".parquet":
        _frame = pd.read_parquet(_path)
    else:
        raise ValueError(f"Unsupported dataset extension: {{_ext}}")
    _DATASET_CACHE[_matched_id] = _frame
    print(f"Loaded {{_path.name}}: {{len(_frame)}} rows x {{len(_frame.columns)}} columns")
    return _frame

def profile_dataset(file_id=None, sample_rows=5, max_columns=50):
    """One-call dataset understanding primitive (<Understand>).

    Returns a compact, bounded summary so the model does not need separate
    df.shape / df.dtypes / df.isna / df.head calls. Mirrors DeepAnalyze's
    Understand action: inspect before computing.
    """
    import pandas as pd  # noqa: F401 - ensure pandas is imported for type sniffing
    _max_cols = int(max_columns) if max_columns else 50
    _sample = max(1, min(int(sample_rows), 10))
    _df = load_dataset(file_id)
    _shape = _df.shape
    _cols = list(_df.columns)
    _truncated = len(_cols) > _max_cols
    _shown_cols = _cols[:_max_cols] if _truncated else _cols
    _dtypes = {{str(col): str(_df[col].dtype) for col in _shown_cols}}
    _missing = {{str(col): int(_df[col].isna().sum()) for col in _shown_cols}}
    _dup = int(_df.duplicated().sum())
    # Numeric summary for shown columns only, bounded
    _numeric_cols = [c for c in _shown_cols if str(_df[c].dtype).startswith(("int", "float", "number"))]
    _summary_lines = [
        f"profile_dataset: shape={{_shape}} cols={{len(_cols)}}{{' (truncated to '+str(_max_cols)+')' if _truncated else ''}}",
        f"columns[{{len(_shown_cols)}}]: {{', '.join(str(c) for c in _shown_cols)}}",
        f"dtypes: {{_dtypes}}",
        f"missing: {{_missing}}",
        f"duplicated_rows: {{_dup}}",
    ]
    if _numeric_cols:
        try:
            _desc = _df[_numeric_cols[: min(8, len(_numeric_cols))]].describe().round(3).to_string()
            _summary_lines.append(f"numeric_describe (first {{min(8, len(_numeric_cols))}} numeric cols):\\n{{_desc}}")
        except Exception as _exc:
            _summary_lines.append(f"numeric_describe: <failed: {{_exc}}>")
    try:
        _head = _df.head(_sample).to_string(index=False, max_cols=_max_cols)
        # Hard cap on printed chars to keep observation bounded (~6k)
        if len(_head) > 4000:
            _head = _head[:4000] + "\\n...[head truncated]..."
        _summary_lines.append(f"head({{_sample}}):\\n{{_head}}")
    except Exception as _exc:
        _summary_lines.append(f"head: <failed: {{_exc}}>")
    _out = "\\n".join(_summary_lines)
    print(_out)
    return {{
        "shape": _shape,
        "columns": _cols,
        "shown_columns": _shown_cols,
        "truncated": _truncated,
        "dtypes": _dtypes,
        "missing": _missing,
        "duplicated_rows": _dup,
        "sample_rows": _sample,
    }}


def list_workspace_files():
    """Return paths and sizes for files under the active workspace."""
    _root = _workspace_path()
    _items = []
    for _path in _root.rglob("*"):
        if ".sessions" in _path.parts:
            continue
        if _path.is_file() and not _path.name.startswith("."):
            _items.append({{
                "path": _path.relative_to(_root).as_posix(),
                "size_bytes": _path.stat().st_size,
            }})
    if _ACTIVE_SESSION_ID:
        _generated = _session_path("generated")
        if _generated.is_dir():
            for _path in _generated.rglob("*"):
                if _path.is_file() and not _path.name.startswith("."):
                    _items.append({{
                        "path": (_RLMPath("generated") / _path.relative_to(_generated)).as_posix(),
                        "size_bytes": _path.stat().st_size,
                    }})
    return sorted(_items, key=lambda item: item["path"].lower())

def read_workspace_file(relative_path, start=0, length=None, encoding="utf-8"):
    """Read a text slice without printing the whole file into root-model context."""
    _path = _visible_path(relative_path)
    with _path.open("r", encoding=encoding) as _handle:
        if start:
            _handle.seek(int(start))
        return _handle.read() if length is None else _handle.read(int(length))

def save_artifact(relative_path, content):
    """Save text, bytes, JSON, or a plot/image below generated/."""
    _relative = _RLMPath(str(relative_path))
    # The public contract says this helper writes *below* generated/. Models
    # nevertheless often pass the visible workspace path (generated/report).
    # Treat both spellings identically instead of creating generated/generated.
    if _relative.parts and _relative.parts[0] == "generated":
        _relative = _RLMPath(*_relative.parts[1:])
    _target = _session_path(_RLMPath("generated") / _relative)
    _target.parent.mkdir(parents=True, exist_ok=True)
    _suffix = _target.suffix.lower()
    try:
        if isinstance(content, (bytes, bytearray, memoryview)):
            _target.write_bytes(bytes(content))
        elif isinstance(content, str):
            _target.write_text(content, encoding="utf-8")
        elif callable(getattr(content, "savefig", None)):
            # Matplotlib Figure: str(fig) is only "Figure(1800x1200)" and
            # used to create a corrupt 17-byte .png. Let Matplotlib encode
            # the actual image using the requested file extension.
            if not _suffix:
                raise ValueError("A plotted figure requires a file extension such as .png or .pdf")
            content.savefig(_target, format=_suffix.lstrip("."), bbox_inches="tight")
        elif _suffix in {{".png", ".jpg", ".jpeg", ".webp", ".gif"}} and callable(getattr(content, "save", None)):
            # Pillow Image and compatible image objects.
            content.save(_target)
        elif isinstance(content, (dict, list, tuple, int, float, bool)) or content is None:
            _target.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            raise TypeError(
                "save_artifact content must be text, bytes, JSON-compatible data, "
                "a Matplotlib Figure, or a Pillow Image"
            )

        # Fail at creation time instead of advertising a corrupt download.
        _data = _target.read_bytes()
        if not _data:
            raise ValueError(f"Artifact {{_target.name}} is empty")
        _valid = {{
            ".png": _data.startswith(b"\\x89PNG\\r\\n\\x1a\\n"),
            ".jpg": _data.startswith(b"\\xff\\xd8\\xff"),
            ".jpeg": _data.startswith(b"\\xff\\xd8\\xff"),
            ".gif": _data.startswith((b"GIF87a", b"GIF89a")),
            ".webp": len(_data) >= 12 and _data[:4] == b"RIFF" and _data[8:12] == b"WEBP",
            ".pdf": _data.startswith(b"%PDF-"),
        }}
        if _suffix in _valid and not _valid[_suffix]:
            raise ValueError(f"Artifact {{_target.name}} is not valid {{_suffix}} data")
    except Exception:
        _target.unlink(missing_ok=True)
        raise
    return (_RLMPath("generated") / _relative).as_posix()

import threading as _job_threading
import time as _job_time
import uuid as _job_uuid
_JOBS = {{}}
_JOBS_LOCK = _job_threading.Lock()

def run_job(code, job_id=None):
    """Run code in background thread, log to generated/jobs/<id>.log (DSH jobs pattern)."""
    _id = str(job_id or _job_uuid.uuid4().hex[:12])
    _log_rel = _RLMPath("generated") / _RLMPath("jobs") / (_id + ".log")
    _log_path = _session_path(_log_rel)
    _log_path.parent.mkdir(parents=True, exist_ok=True)
    def _target():
        try:
            with _log_path.open("a", encoding="utf-8") as _lf:
                _lf.write(f"\\n--- job {{_id}} started at {{_job_time.time()}} ---\\n")
            exec(code, globals())
            with _log_path.open("a", encoding="utf-8") as _lf:
                _lf.write(f"\\n--- job {{_id}} done at {{_job_time.time()}} ---\\n")
        except Exception as _e:
            with _log_path.open("a", encoding="utf-8") as _lf:
                _lf.write(f"\\n--- job {{_id}} error: {{_e}} ---\\n")
                import traceback as _tb
                _tb.print_exc(file=_lf)
        finally:
            with _JOBS_LOCK:
                if _id in _JOBS:
                    _JOBS[_id]["status"] = "done"
    with _JOBS_LOCK:
        _JOBS[_id] = {{"status": "running", "log": _log_rel.as_posix(), "started": _job_time.time()}}
    _t = _job_threading.Thread(target=_target, daemon=True)
    _t.start()
    print(f"job {{_id}} started, log: {{_JOBS[_id]['log']}}")
    return _id

def job_output(job_id, offset=0, length=4000):
    """Read background job log slice."""
    _id = str(job_id)
    with _JOBS_LOCK:
        _info = _JOBS.get(_id)
    if _info is None:
        # try direct file
        _p = _session_path(_RLMPath("generated") / _RLMPath("jobs") / (_id + ".log"))
        if not _p.exists():
            return f"job {{_id}} not found"
        _info = {{"log": _p.relative_to(_workspace_path()).as_posix()}}
    _p = _session_path(_info["log"])
    if not _p.exists():
        return ""
    _text = _p.read_text(encoding="utf-8", errors="replace")
    return _text[int(offset): int(offset)+int(length)] if length else _text[int(offset):]

def job_list():
    """List background jobs."""
    with _JOBS_LOCK:
        return [{{"id": k, **v}} for k, v in _JOBS.items()]

os.chdir(_session_path())

{control_setup_code()}
'''.strip()
