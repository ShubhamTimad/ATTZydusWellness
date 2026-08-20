"""Create-time image upload should not add a second audit event."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def test_set_asset_image_skips_audit_when_part_of_create(monkeypatch: pytest.MonkeyPatch) -> None:
    from modules.assets.service import AssetMasterService

    logged: list[str] = []

    def fake_log(_db, *, asset_id, actor_user_id, action, **_kwargs):
        logged.append(action)

    monkeypatch.setattr("modules.assets.service.log_asset_event", fake_log)
    monkeypatch.setattr(
        "modules.assets.service.validate_asset_image",
        lambda _data: "image/jpeg",
    )

    asset = SimpleNamespace(
        id=1,
        image_content_type=None,
        image_data=None,
        image_filename=None,
        updated_at=None,
    )
    db = MagicMock()
    svc = AssetMasterService(db)
    monkeypatch.setattr(svc, "_load_asset", lambda _id: asset)
    monkeypatch.setattr(svc, "_assert_asset_action_allowed", lambda *_a, **_k: None)

    svc.set_asset_image(
        1,
        data=b"fake",
        filename="a.jpg",
        actor_user_id=7,
        part_of_create=True,
    )
    assert logged == []

    asset.image_content_type = None
    svc.set_asset_image(
        1,
        data=b"fake",
        filename="b.jpg",
        actor_user_id=7,
        part_of_create=False,
    )
    assert logged == ["asset_image_added"]
