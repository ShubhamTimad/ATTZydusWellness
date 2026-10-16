"""Pending-approval badges show the waiting role (Pending Approval – CF)."""

from __future__ import annotations

from modules.platform.approvals.list_inbox import pending_role_names_for_requests


def test_pending_role_names_skips_query_when_empty() -> None:
    class _Db:
        def execute(self, *_a, **_k):
            raise AssertionError("should not query")

    assert pending_role_names_for_requests(_Db(), []) == {}


def test_compact_pending_role_matches_ui_examples() -> None:
    """Keep in sync with compactPendingRoleLabel in disposal-types.ts."""
    filler = {"department", "user", "person", "the", "of", "and"}

    def compact(role_name: str | None) -> str | None:
        if not role_name or not role_name.strip():
            return None
        tokens = [t for t in role_name.strip().split() if t]
        kept = [t for t in tokens if t.lower() not in filler]
        parts = kept or tokens
        if len(parts) == 1:
            return parts[0]
        return "".join(t[0].upper() for t in parts)

    assert compact("Central Finance") == "CF"
    assert compact("Department HOD") == "HOD"
    assert compact("MD") == "MD"
    assert compact("Cost Center User") == "CC"
    assert compact(None) is None
