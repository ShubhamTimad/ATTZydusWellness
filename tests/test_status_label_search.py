"""Status label free-text search helpers."""

from __future__ import annotations

from core.label_search import codes_matching_label_search, normalize_search_needle
from modules.capex.constants import status_codes_matching_search as capex_status_search
from modules.disposals.constants import status_codes_matching_search as disposal_status_search
from modules.orders.constants import status_codes_matching_search as order_status_search
from modules.transfers.constants import status_codes_matching_search as transfer_status_search


def test_normalize_search_needle() -> None:
    assert normalize_search_needle("  Pending_Approval  ") == "pending approval"
    assert normalize_search_needle("") == ""


def test_codes_matching_label_search() -> None:
    labels = {"pending_approval": "Pending Approval", "cancelled": "Archived"}
    assert codes_matching_label_search("pending", labels) == ["pending_approval"]
    assert codes_matching_label_search("Archived", labels) == ["cancelled"]
    assert codes_matching_label_search("zzz", labels) == []


def test_domain_status_search_matches_ui_labels() -> None:
    assert "pending_approval" in order_status_search("Pending Approval")
    assert "cancelled" in order_status_search("Archived")
    assert "in_progress" in order_status_search("in progress")
    assert "approved_by_cf" in transfer_status_search("Pending Receive")
    assert "cancelled" in disposal_status_search("Archived")
    assert "pending_approval" in disposal_status_search("pending")
    assert capex_status_search("approved") == ["approved"]
    assert "cancelled" in capex_status_search("archived")
