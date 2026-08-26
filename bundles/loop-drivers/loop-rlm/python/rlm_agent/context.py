"""Build canonical persistent-RLM context payloads for the data agent."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from .memory import SessionMemoryStore
from .types import ContextSnapshot, ControlEvent


TABULAR_EXTENSIONS = {".csv", ".tsv", ".xlsx", ".xls", ".parquet"}
MAX_MEMORY_DATASETS = 10
MAX_MEMORY_COLUMNS = 50
MAX_MEMORY_ARTIFACTS = 50


class ContextBuilder:
    def __init__(self, workspace_base: str | Path, max_files: int = 200):
        self.workspace_base = Path(workspace_base).resolve()
        self.max_files = max_files
        self.session_memory = SessionMemoryStore()

    def workspace_root(self, session_id: str) -> Path:
        safe = "".join(ch for ch in (session_id or "default") if ch.isalnum() or ch in "._-")
        safe = safe.strip(".-") or "default"
        root = (self.workspace_base / safe).resolve()
        if root != self.workspace_base and self.workspace_base not in root.parents:
            raise ValueError("Invalid workspace session id")
        root.mkdir(parents=True, exist_ok=True)
        return root

    def build(
        self,
        user_message: str,
        session_id: str,
        context_index: int,
        pending_control: ControlEvent | None = None,
        selected_skill: dict[str, Any] | None = None,
        register_context: bool = True,
    ) -> ContextSnapshot:
        root = self.workspace_root(session_id)
        index = self._load_index(root)
        active_id, active_entry = self._active_dataset(index)
        context_type = "human_response" if pending_control else "user_request"
        if register_context:
            self.session_memory.record_context(
                root,
                context_index=context_index,
            )
        session_memory = self.session_memory.snapshot(
            root,
            active_datasets=self._dataset_manifest(root, index, active_id),
            artifacts=self._artifact_manifest(root),
            current_context_index=context_index if register_context else None,
        )
        if context_index == 0:
            payload: dict[str, Any] = {
                "type": "user_request",
                "request": user_message,
                "datasets": self._dataset_contents(root, index),
                "active_dataset": self._dataset_summary(root, active_id, active_entry),
                "session_memory": session_memory,
            }
        else:
            payload = {
                "type": context_type,
                "request": user_message,
                "human_response": {
                    "for": pending_control.to_dict(),
                    "content": user_message,
                } if pending_control else None,
                "session_memory": session_memory,
            }
        if selected_skill is not None:
            payload["selected_skill"] = selected_skill
        return ContextSnapshot(
            session_id=session_id,
            context_index=context_index,
            payload=payload,
        )

    def inspect_workspace(self, session_id: str) -> dict[str, Any]:
        """Read workspace data only; session/skill/memory ownership stays with the harness."""
        return self.inspect_workspace_root(self.workspace_root(session_id))

    def inspect_workspace_root(self, workspace_root: str | Path) -> dict[str, Any]:
        """Inspect an already-authorized root supplied by the host harness."""
        root = Path(workspace_root).resolve()
        index = self._load_index(root)
        active_id, active_entry = self._active_dataset(index)
        return {
            "datasets": self._dataset_contents(root, index),
            "active_dataset": self._dataset_summary(root, active_id, active_entry),
            "resources": {
                "datasets": self._dataset_manifest(root, index, active_id),
                "artifacts": self._artifact_manifest(root),
            },
        }

    @classmethod
    def _dataset_contents(
        cls,
        root: Path,
        index: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Return every registered tabular dataset with its complete file content."""
        entries = [
            (file_id, entry)
            for file_id, entry in index.items()
            if Path(str(entry.get("filename") or entry.get("path") or "")).suffix.lower()
            in TABULAR_EXTENSIONS
        ]
        entries.sort(key=lambda pair: str(pair[1].get("created_at", "")))
        datasets: list[dict[str, Any]] = []
        for file_id, entry in entries:
            relative = str(entry.get("path") or "")
            path = (root / relative).resolve()
            if not relative or root not in path.parents or not path.is_file():
                continue
            suffix = path.suffix.lower()
            metadata = cls._metadata(root, entry)
            raw = path.read_bytes()
            dataset: dict[str, Any] = {
                "id": file_id,
                "filename": entry.get("filename") or path.name,
                "format": suffix.lstrip("."),
                "size_bytes": len(raw),
                "metadata": metadata,
            }
            if suffix in {".csv", ".tsv"}:
                content, encoding = cls._decode_text(raw, metadata.get("encoding"))
                dataset.update({
                    "representation": "text",
                    "encoding": encoding,
                    "content": content,
                })
            else:
                dataset.update({
                    "representation": "base64",
                    "encoding": "base64",
                    "content": base64.b64encode(raw).decode("ascii"),
                })
            datasets.append(dataset)
        return datasets

    @staticmethod
    def _decode_text(raw: bytes, preferred: Any = None) -> tuple[str, str]:
        candidates = ([str(preferred)] if preferred else []) + [
            "utf-8", "utf-8-sig", "cp1258", "latin-1"
        ]
        seen: set[str] = set()
        for encoding in candidates:
            if not encoding or encoding in seen:
                continue
            seen.add(encoding)
            try:
                return raw.decode(encoding), encoding
            except (LookupError, UnicodeDecodeError):
                continue
        return raw.decode("latin-1"), "latin-1"

    @staticmethod
    def _metadata(root: Path, entry: dict[str, Any]) -> dict[str, Any]:
        relative = entry.get("metadata_file")
        if not relative:
            return {}
        path = (root / str(relative)).resolve()
        if root not in path.parents or not path.is_file():
            return {}
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _load_index(root: Path) -> dict[str, dict[str, Any]]:
        path = root / "index.json"
        if not path.exists():
            return {}
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _active_dataset(
        index: dict[str, dict[str, Any]],
    ) -> tuple[str | None, dict[str, Any] | None]:
        entries = [
            (file_id, entry)
            for file_id, entry in index.items()
            if Path(str(entry.get("filename") or entry.get("path") or "")).suffix.lower()
            in TABULAR_EXTENSIONS
        ]
        if not entries:
            return None, None
        entries.sort(key=lambda pair: str(pair[1].get("created_at", "")), reverse=True)
        return entries[0]

    @staticmethod
    def _dataset_summary(
        root: Path,
        file_id: str | None,
        entry: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if not file_id or not entry:
            return None
        relative = str(entry.get("path", ""))
        path = (root / relative).resolve()
        summary: dict[str, Any] = {
            "id": file_id,
            "filename": entry.get("filename") or path.name,
            "path": relative,
            "size_bytes": path.stat().st_size if path.exists() else None,
        }
        metadata = ContextBuilder._metadata(root, entry)
        for key in ("rows", "columns", "dtypes", "separator", "encoding"):
            if key in metadata:
                summary[key] = metadata[key]
        return summary

    @classmethod
    def _dataset_manifest(
        cls,
        root: Path,
        index: dict[str, dict[str, Any]],
        active_id: str | None,
    ) -> list[dict[str, Any]]:
        entries = [
            (file_id, entry)
            for file_id, entry in index.items()
            if Path(str(entry.get("filename") or entry.get("path") or "")).suffix.lower()
            in TABULAR_EXTENSIONS
        ]
        entries.sort(key=lambda pair: str(pair[1].get("created_at", "")), reverse=True)
        manifest: list[dict[str, Any]] = []
        for file_id, entry in entries[:MAX_MEMORY_DATASETS]:
            summary = cls._dataset_summary(root, file_id, entry)
            if summary is None:
                continue
            summary["active"] = file_id == active_id
            columns = summary.get("columns")
            if isinstance(columns, list) and len(columns) > MAX_MEMORY_COLUMNS:
                summary["columns"] = columns[:MAX_MEMORY_COLUMNS]
                summary["columns_truncated"] = len(columns) - MAX_MEMORY_COLUMNS
            dtypes = summary.get("dtypes")
            if isinstance(dtypes, dict):
                summary["dtypes"] = dict(list(dtypes.items())[:MAX_MEMORY_COLUMNS])
                if len(dtypes) > MAX_MEMORY_COLUMNS:
                    summary["dtypes_truncated"] = len(dtypes) - MAX_MEMORY_COLUMNS
            manifest.append(summary)
        return manifest

    def _artifact_manifest(self, root: Path) -> list[str]:
        generated = (root / "generated").resolve()
        if not generated.is_dir():
            return []
        artifacts: list[str] = []
        for path in sorted(generated.rglob("*")):
            if not path.is_file():
                continue
            artifacts.append(path.relative_to(root).as_posix())
            if len(artifacts) >= min(self.max_files, MAX_MEMORY_ARTIFACTS):
                break
        return artifacts
