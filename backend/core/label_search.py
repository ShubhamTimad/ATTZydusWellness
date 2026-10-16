"""Match free-text search needles against status display labels (and raw codes)."""

from __future__ import annotations

from collections.abc import Mapping


def normalize_search_needle(query: str | None) -> str:
    return " ".join((query or "").strip().lower().replace("_", " ").split())


def codes_matching_label_search(query: str | None, labels: Mapping[str, str]) -> list[str]:
    """Return status codes whose display label or raw code contains the needle."""
    needle = normalize_search_needle(query)
    if not needle:
        return []
    matched: list[str] = []
    for code, label in labels.items():
        raw = str(code).replace("_", " ").lower()
        lab = normalize_search_needle(str(label))
        if needle in lab or needle in raw:
            matched.append(str(code))
    return matched
