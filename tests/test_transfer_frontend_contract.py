"""Transfer audit trail should stay compact like disposal (decision-first, no field dumps)."""

from __future__ import annotations

from pathlib import Path

AUDIT = (
    Path(__file__).resolve().parents[1]
    / "frontend/src/pages/transfers/transfer-audit-log.tsx"
)
TYPES = (
    Path(__file__).resolve().parents[1]
    / "frontend/src/lib/transfer-types.ts"
)


def test_transfer_audit_log_matches_disposal_style() -> None:
    src = AUDIT.read_text(encoding="utf-8")
    assert "transferAuditHeadline" in src
    assert "transferAuditDetailLines" in src
    assert "Approved —" in src
    assert "Rejected —" in src
    assert "Comment:" in src
    assert "Next:" in src
    assert "Returned to:" in src
    assert "from_value" not in src
    assert "grid-cols-[minmax" not in src
    assert "→" not in src or "Status: ${statusFrom} → ${statusTo}" in src


def test_pending_approval_label_includes_waiting_role() -> None:
    src = TYPES.read_text(encoding="utf-8")
    assert "pending_role_name" in src
    assert "${base} – ${compact}" in src
