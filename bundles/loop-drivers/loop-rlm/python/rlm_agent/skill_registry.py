"""Provider-backed catalog for skill packages and their resources."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_RESOURCE_DIRS = {
    "assets",
    "references",
    "checklists",
    "scripts",
    "templates",
}


@dataclass(frozen=True)
class SkillCandidate:
    """Small catalog entry; ``name`` is also the complete lookup locator."""

    name: str
    description: str = ""
    user_invocable: bool = False


@dataclass(frozen=True)
class SkillDefinition:
    """Loaded content plus the resources reachable from this definition."""

    metadata: SkillCandidate
    content: str
    resource_base: Path
    resources: tuple[str, ...] = ()


class SkillProvider(Protocol):
    def list(self) -> list[SkillCandidate]: ...

    def get(self, name: str) -> SkillDefinition: ...


def _frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    metadata: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        key, separator, value = line.partition(":")
        if separator:
            metadata[key.strip()] = value.strip().strip('"').strip("'")
    return metadata


class FilesystemSkillProvider:
    """Discover skill folders and package resources below one filesystem root."""

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()

    def list(self) -> list[SkillCandidate]:
        return sorted(
            (item[0] for item in self._definitions().values()),
            key=lambda item: item.name,
        )

    def get(self, name: str) -> SkillDefinition:
        definitions = self._definitions()
        if name not in definitions:
            raise KeyError(name)
        metadata, path, resource_base = definitions[name]
        resources: tuple[str, ...] = ()
        if "::" not in metadata.name:
            prefix = f"{metadata.name}::"
            resources = tuple(
                candidate.name
                for candidate in sorted(
                    (item[0] for item in definitions.values()),
                    key=lambda item: item.name,
                )
                if candidate.name.startswith(prefix)
            )
        return SkillDefinition(
            metadata=metadata,
            content=path.read_text(encoding="utf-8"),
            resource_base=resource_base,
            resources=resources,
        )

    def _definitions(self) -> dict[str, tuple[SkillCandidate, Path, Path]]:
        definitions: dict[str, tuple[SkillCandidate, Path, Path]] = {}
        if not self.root.is_dir():
            return definitions

        for entrypoint in sorted(self.root.glob("*/SKILL.md")):
            skill_root = entrypoint.parent.resolve()
            if self.root != skill_root and self.root not in skill_root.parents:
                continue
            metadata = _frontmatter(entrypoint.read_text(encoding="utf-8"))
            skill_name = metadata.get("name") or skill_root.name
            candidate = SkillCandidate(
                name=skill_name,
                description=metadata.get("description", ""),
                user_invocable=metadata.get("user-invocable", "true").lower() != "false",
            )
            definitions[candidate.name] = (candidate, entrypoint, skill_root)

            for directory in sorted(PACKAGE_RESOURCE_DIRS):
                resource_root = skill_root / directory
                if not resource_root.is_dir():
                    continue
                for resource in sorted(resource_root.rglob("*")):
                    resolved = resource.resolve()
                    if not resource.is_file() or skill_root not in resolved.parents:
                        continue
                    relative = resolved.relative_to(skill_root)
                    resource_candidate = SkillCandidate(
                        name=f"{skill_name}::{relative.as_posix()}",
                    )
                    definitions[resource_candidate.name] = (
                        resource_candidate,
                        resolved,
                        skill_root,
                    )
        return definitions


class SkillRegistry:
    def __init__(self):
        self.providers: list[SkillProvider] = []

    def register_provider(self, provider: SkillProvider) -> None:
        self.providers.append(provider)

    def list(
        self,
        parent: str | None = None,
        *,
        user_invocable_only: bool = False,
    ) -> list[SkillCandidate]:
        catalog: dict[str, SkillCandidate] = {}
        for provider in self.providers:
            for candidate in provider.list():
                if candidate.name in catalog:
                    raise ValueError(f"Duplicate skill locator: {candidate.name!r}")
                catalog[candidate.name] = candidate
        candidates = list(catalog.values())
        if parent:
            prefix = f"{parent}::"
            candidates = [item for item in candidates if item.name.startswith(prefix)]
        if user_invocable_only:
            candidates = [item for item in candidates if item.user_invocable]
        return sorted(candidates, key=lambda item: item.name)

    def get(self, name: str) -> SkillDefinition:
        normalized = str(name or "").strip()
        matches: list[SkillDefinition] = []
        for provider in self.providers:
            try:
                matches.append(provider.get(normalized))
            except KeyError:
                continue
        if not matches:
            raise ValueError(
                f"Skill {normalized!r} not found; available skills: "
                f"{[item.name for item in self.list()]}"
            )
        if len(matches) > 1:
            raise ValueError(f"Duplicate skill locator: {normalized!r}")
        return matches[0]


def build_skill_registry(repo_root: str | Path = REPO_ROOT) -> SkillRegistry:
    root = Path(repo_root).resolve()
    registry = SkillRegistry()
    registry.register_provider(
        FilesystemSkillProvider(root / "triadic_dgm" / "rlm_agent" / "skills")
    )
    return registry


DEFAULT_SKILL_REGISTRY = build_skill_registry()


def skill_tool(name: str, registry: SkillRegistry = DEFAULT_SKILL_REGISTRY) -> dict[str, Any]:
    """Load either a top-level skill or one resource through the same tool."""
    skill = registry.get(name)
    metadata = skill.metadata
    result = {
        "name": metadata.name,
        "content": skill.content,
        "resource_base": str(skill.resource_base),
        "resources": list(skill.resources),
    }
    if metadata.description:
        result["description"] = metadata.description
    return result


# Compatibility adapters for the existing API and selected-skill context builder.
def list_skills(
    *,
    user_invocable_only: bool = False,
    skills_root: str | Path | None = None,
) -> list[dict[str, Any]]:
    registry = DEFAULT_SKILL_REGISTRY
    if skills_root is not None:
        registry = SkillRegistry()
        registry.register_provider(FilesystemSkillProvider(skills_root))
    candidates = [
        item
        for item in registry.list(user_invocable_only=user_invocable_only)
        if "::" not in item.name
    ]
    return [
        {
            "name": item.name,
            "description": item.description,
            "argument_hint": _frontmatter(registry.get(item.name).content).get(
                "argument-hint", ""
            ),
            "user_invocable": item.user_invocable,
        }
        for item in candidates
    ]


def read_skill(
    name: str,
    *,
    skills_root: str | Path | None = None,
) -> str:
    registry = DEFAULT_SKILL_REGISTRY
    if skills_root is not None:
        registry = SkillRegistry()
        registry.register_provider(FilesystemSkillProvider(skills_root))
    return registry.get(name).content


def load_selected_skill(name: str | None) -> dict[str, Any] | None:
    if not name:
        return None
    normalized = str(name).strip()
    catalog = {
        entry["name"]: entry for entry in list_skills(user_invocable_only=True)
    }
    if normalized not in catalog:
        raise ValueError(
            f"Skill {normalized!r} is not user-invocable; available skills: "
            f"{sorted(catalog)}"
        )
    return {**catalog[normalized], "instructions": read_skill(normalized)}
