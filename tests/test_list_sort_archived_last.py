"""Archived (cancelled) rows stay last unless Status is filtered to Archived."""

from __future__ import annotations

from sqlalchemy import Column, Integer, String, select, table

from modules.list_sort import apply_sort_dir, archived_last_expr


_orders = table(
    "orders",
    Column("id", Integer),
    Column("created_at", Integer),
    Column("status", String),
)


def test_archived_last_unless_status_filter_is_cancelled() -> None:
    assert archived_last_expr(_orders.c.status, status_filter=None) is not None
    assert archived_last_expr(_orders.c.status, status_filter="") is not None
    assert archived_last_expr(_orders.c.status, status_filter="draft") is not None
    assert archived_last_expr(_orders.c.status, status_filter="cancelled") is None
    assert archived_last_expr(_orders.c.status, status_filter=" Cancelled ") is None


def test_pin_last_sorts_before_created_at() -> None:
    pin = archived_last_expr(_orders.c.status, status_filter=None)
    stmt = apply_sort_dir(
        select(_orders),
        _orders.c.created_at,
        sort_dir="desc",
        tiebreaker=_orders.c.id,
        pin_last=pin,
    )
    order_by = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower().split("order by", 1)[1]
    assert order_by.find("case") < order_by.find("created_at")
    unpinned = apply_sort_dir(
        select(_orders),
        _orders.c.created_at,
        sort_dir="desc",
        tiebreaker=_orders.c.id,
        pin_last=archived_last_expr(_orders.c.status, status_filter="cancelled"),
    )
    unpinned_order = str(unpinned.compile(compile_kwargs={"literal_binds": True})).lower()
    assert "case" not in unpinned_order.split("order by", 1)[1]
