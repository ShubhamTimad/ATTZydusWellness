"""Unarchive restores the status recorded when the form was archived."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from modules.capex.constants import STATUS_CANCELLED, STATUS_DRAFT, STATUS_REJECTED
from modules.capex.service import CapexFormService


def test_unarchive_restores_pre_archive_status() -> None:
    form = SimpleNamespace(
        id=1,
        status=STATUS_CANCELLED,
        created_by=2,
        approval_request_id=None,
    )
    audit = SimpleNamespace(old_value={"status": STATUS_REJECTED})
    db = MagicMock()
    db.scalar.return_value = audit
    svc = CapexFormService(db)

    with patch.object(svc, "_load", return_value=form):
        with patch.object(svc, "_to_detail", return_value="detail"):
            with patch("modules.capex.service._actor_may_discard_capex", return_value=True):
                with patch("modules.capex.service.log_capex_event"):
                    result = svc.unarchive_form(1, actor_user_id=2)

    assert result == "detail"
    assert form.status == STATUS_REJECTED
    db.commit.assert_called_once()


def test_unarchive_falls_back_to_draft_when_audit_missing() -> None:
    form = SimpleNamespace(
        id=1,
        status=STATUS_CANCELLED,
        created_by=2,
        approval_request_id=None,
    )
    db = MagicMock()
    db.scalar.return_value = None
    svc = CapexFormService(db)

    with patch.object(svc, "_load", return_value=form):
        with patch.object(svc, "_to_detail", return_value="detail"):
            with patch("modules.capex.service._actor_may_discard_capex", return_value=True):
                with patch("modules.capex.service.log_capex_event"):
                    svc.unarchive_form(1, actor_user_id=2)

    assert form.status == STATUS_DRAFT
