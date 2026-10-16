"""Asset list can_approve gating for pending workflow assignees."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules.assets.service import AssetMasterService


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


def test_asset_ids_viewer_can_approve_named_and_role(monkeypatch: pytest.MonkeyPatch) -> None:
    tasks = [
        SimpleNamespace(
            request_id=10,
            task_type="approval",
            status="pending",
            assigned_user_id=7,
            assigned_role_id=None,
        ),
        SimpleNamespace(
            request_id=11,
            task_type="approval",
            status="pending",
            assigned_user_id=None,
            assigned_role_id=3,
        ),
    ]

    class FakeDb:
        def execute(self, _stmt):
            return _Result([(10, 100), (11, 101)])

        def scalars(self, _stmt):
            return _Scalars(tasks)

    class FakeEngine:
        def __init__(self, _db):
            pass

        def _role_ids_for_user(self, uid: int):
            return {3} if uid == 8 else set()

    monkeypatch.setattr(
        "modules.platform.approvals.service.ApprovalEngineService",
        FakeEngine,
    )

    svc = AssetMasterService(FakeDb())  # type: ignore[arg-type]
    assert svc._asset_ids_viewer_can_approve([100, 101], viewer_user_id=7) == {100}
    assert svc._asset_ids_viewer_can_approve([100, 101], viewer_user_id=8) == {101}
    assert svc._asset_ids_viewer_can_approve([100, 101], viewer_user_id=1) == set()
    assert svc._asset_ids_viewer_can_approve([], viewer_user_id=7) == set()
