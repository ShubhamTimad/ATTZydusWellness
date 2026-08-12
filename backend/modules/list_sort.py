"""Shared list sort helpers for order / form tables."""

from __future__ import annotations

from typing import Any


def apply_sort_dir(stmt: Any, order_col: Any, *, sort_dir: str, tiebreaker: Any) -> Any:
    """Apply asc/desc with nulls last and a stable tiebreaker column."""
    if (sort_dir or "desc").strip().lower() == "asc":
        return stmt.order_by(order_col.asc().nulls_last(), tiebreaker.asc())
    return stmt.order_by(order_col.desc().nulls_last(), tiebreaker.desc())
