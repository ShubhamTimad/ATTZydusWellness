"""The disposal UI hard-codes tab keys and status labels; fail here when the backend drifts."""

from __future__ import annotations

import re
from pathlib import Path

from modules.disposals.constants import STATUS_LABELS
from modules.disposals.service import _TAB_STATUSES

TYPES_FILE = Path(__file__).resolve().parents[1] / "frontend/src/lib/disposal-types.ts"


def _ts_source() -> str:
    return TYPES_FILE.read_text(encoding="utf-8")


def test_status_tabs_match_backend_tabs() -> None:
    block = re.search(r"DISPOSAL_STATUS_TABS = \[(.*?)\] as const", _ts_source(), re.S)
    assert block is not None, "DISPOSAL_STATUS_TABS not found"
    keys = re.findall(r'key:\s*"([^"]+)"', block.group(1))
    # UI shows the action-first pair; backend may keep legacy status keys too.
    assert set(keys) == {"all", "needs_action"}
    assert set(keys) <= set(_TAB_STATUSES)


def test_every_backend_status_has_a_ui_label() -> None:
    block = re.search(r"function disposalStatusLabel.*?\n}", _ts_source(), re.S)
    assert block is not None, "disposalStatusLabel not found"
    labelled = set(re.findall(r"^\s{4}(\w+):", block.group(0), re.M))
    assert set(STATUS_LABELS) <= labelled


def test_progress_does_not_complete_by_role_name() -> None:
    """Duplicate Central Finance steps must not all light up from one audit role name."""
    src = _ts_source()
    assert "approvedDisposalRoleNames" not in src
    assert "s.phase === \"completed\"" in src or 's.phase === "completed"' in src


def test_close_step_labeled_close_in_process_flow() -> None:
    src = _ts_source()
    assert 'kind === "close"' in src
    assert '"Closed"' in src
    assert '"Close"' in src
    # Close must not stay forced-active while an earlier CF approve is still open.
    assert "earlierIncomplete" in src


def test_synthetic_trailers_skipped_for_operational_kinds() -> None:
    src = _ts_source()
    assert "hasOperationalKinds" in src
    assert "stepKindOf" in src


def test_rework_picker_keeps_pending_disposal_assets_on_same_order() -> None:
    """Removing an asset in rework must still allow re-adding it while it stays pending_disposal."""
    detail = (
        Path(__file__).resolve().parents[1]
        / "frontend/src/pages/disposals/disposal-detail.tsx"
    ).read_text(encoding="utf-8")
    assert "isSelectableOnThisOrder" in detail
    assert "pending_disposal" in detail
    assert "reservedAssetIds" in detail


def test_disposal_audit_log_is_short_and_decision_first() -> None:
    src = (
        Path(__file__).resolve().parents[1]
        / "frontend/src/pages/disposals/disposal-audit-log.tsx"
    ).read_text(encoding="utf-8")
    assert "disposalAuditHeadline" in src
    assert "disposalAuditDetailLines" in src
    assert "Approved —" in src
    assert "Rejected —" in src
    assert "Comment:" in src
    assert "Next:" in src
    assert "from_value" not in src
    assert "→" not in src or 'Status: ${statusFrom} → ${statusTo}' in src
