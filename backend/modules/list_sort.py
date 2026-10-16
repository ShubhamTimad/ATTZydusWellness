"""Shared list sort helpers for order / form tables."""

from __future__ import annotations

from typing import Any

from sqlalchemy import case

ARCHIVED_STATUS = "cancelled"


def archived_last_expr(status_col: Any, *, status_filter: str | None) -> Any | None:
    """Pin archived rows last unless the Status filter is already Archived."""
    if (status_filter or "").strip().lower() == ARCHIVED_STATUS:
        return None
    return case((status_col == ARCHIVED_STATUS, 1), else_=0)


def apply_sort_dir(
    stmt: Any,
    order_col: Any,
    *,
    sort_dir: str,
    tiebreaker: Any,
    pin_last: Any | None = None,
) -> Any:
    """Apply asc/desc with nulls last and a stable tiebreaker column."""
    prefix = (pin_last.asc(),) if pin_last is not None else ()
    if (sort_dir or "desc").strip().lower() == "asc":
        return stmt.order_by(*prefix, order_col.asc().nulls_last(), tiebreaker.asc())
    return stmt.order_by(*prefix, order_col.desc().nulls_last(), tiebreaker.desc())
