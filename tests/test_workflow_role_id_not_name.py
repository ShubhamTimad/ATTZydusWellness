"""Workflow assignee pools must resolve by role id, not hardcoded display names."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_disposal_panel_receiver_not_looked_up_by_seeded_name() -> None:
    src = _read("backend/modules/disposals/service.py")
    # Legacy final receiver must use permission, not Role.name == "Cost Center User".
    assert "_role_with_permission(self._db, \"disposal.receive\")" in src
    assert 'Role.name == next_role' not in src or "receiver" not in src.lower()


def test_frontend_next_assignee_urls_prefer_role_id() -> None:
    for rel in (
        "frontend/src/pages/disposals/disposal-detail.tsx",
        "frontend/src/pages/transfers/transfer-detail.tsx",
        "frontend/src/pages/capex/capex-detail.tsx",
    ):
        src = _read(rel)
        assert "assignees?role_id=" in src
        assert 'assignees?level=central_finance' not in src


def test_progress_labels_do_not_map_role_synonyms() -> None:
    disposal = _read("frontend/src/lib/disposal-types.ts")
    assert 'n.includes("finance")' not in disposal
    transfer = _read("frontend/src/lib/transfer-types.ts")
    assert 'n.includes("finance")' not in transfer
    capex = _read("frontend/src/lib/capex-types.ts")
    assert 'n.includes("finance")' not in capex
