"""Duplicate RFID must be a clear 409, also when a soft-deleted asset still holds it."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from modules.assets.router import _rfid_error_response
from modules.assets.service import DuplicateRfidError, _assert_rfid_available


def _db(row):
    return SimpleNamespace(execute=lambda _stmt: SimpleNamespace(first=lambda: row))


def test_deleted_asset_still_holds_rfid() -> None:
    row = (7, "", "CAN-7", datetime.now(timezone.utc))
    with pytest.raises(DuplicateRfidError, match="deleted asset CAN-7") as err:
        _assert_rfid_available(_db(row), rfid="E200", exclude_asset_id=None)  # type: ignore[arg-type]
    http = _rfid_error_response(err.value)
    assert http.status_code == 409
    assert "E200" in http.detail["message"]


def test_free_rfid_passes() -> None:
    _assert_rfid_available(_db(None), rfid="E200", exclude_asset_id=1)  # type: ignore[arg-type]
