"""Generate the bootstrap code installed in the persistent IPython notebook."""

from __future__ import annotations

from pathlib import Path

from .controls import control_setup_code


def build_notebook_setup_code(workspace_root: str | Path, repo_root: str | Path) -> str:
    workspace = str(Path(workspace_root).resolve())
    repo = str(Path(repo_root).resolve())
    return f'''
import json
import os
import sys
from pathlib import Path as _RLMPath

_ACTIVE_WORKSPACE_ROOT = {workspace!r}
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

def list_workspace_files():
    """Return paths and sizes for files under the active workspace."""
    _root = _workspace_path()
    _items = []
    for _path in _root.rglob("*"):
        if _path.is_file() and not _path.name.startswith("."):
            _items.append({{
                "path": _path.relative_to(_root).as_posix(),
                "size_bytes": _path.stat().st_size,
            }})
    return sorted(_items, key=lambda item: item["path"].lower())

def read_workspace_file(relative_path, start=0, length=None, encoding="utf-8"):
    """Read a text slice without printing the whole file into root-model context."""
    _path = _workspace_path(relative_path)
    with _path.open("r", encoding=encoding) as _handle:
        if start:
            _handle.seek(int(start))
        return _handle.read() if length is None else _handle.read(int(length))

def save_artifact(relative_path, content):
    """Save text/bytes below generated/ and return its workspace-relative path."""
    _relative = _RLMPath(str(relative_path))
    _target = _workspace_path(_RLMPath("generated") / _relative)
    _target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        _target.write_bytes(content)
    else:
        _target.write_text(str(content), encoding="utf-8")
    return _target.relative_to(_workspace_path()).as_posix()

os.chdir(_workspace_path())

{control_setup_code()}
'''.strip()
