"""Asset Number / Combined Asset No reject special characters."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from modules.assets.field_definitions import (
    ASSET_NUMBER_SPECIAL_CHARS_MSG,
    asset_number_has_special_chars,
    normalize_asset_number_field,
)
from modules.assets.schema import AssetCreateRequest, AssetUpdateRequest


def test_normalize_accepts_alnum_and_hyphen() -> None:
    assert normalize_asset_number_field("  ab-12  ") == "AB-12"
    assert normalize_asset_number_field("") is None
    assert normalize_asset_number_field(None) is None


def test_normalize_rejects_special_chars() -> None:
    with pytest.raises(ValueError, match=ASSET_NUMBER_SPECIAL_CHARS_MSG):
        normalize_asset_number_field("AB@12")
    with pytest.raises(ValueError, match=ASSET_NUMBER_SPECIAL_CHARS_MSG):
        normalize_asset_number_field("AB 12")
    with pytest.raises(ValueError, match=ASSET_NUMBER_SPECIAL_CHARS_MSG):
        normalize_asset_number_field("AB_12")


def test_has_special_chars() -> None:
    assert asset_number_has_special_chars("OK-1") is False
    assert asset_number_has_special_chars("BAD#1") is True
    assert asset_number_has_special_chars("") is False


def test_create_request_rejects_special_chars() -> None:
    with pytest.raises(ValidationError):
        AssetCreateRequest(
            asset_name="Pump",
            combined_asset_number="CAN@001",
        )


def test_update_request_rejects_special_chars() -> None:
    with pytest.raises(ValidationError):
        AssetUpdateRequest(asset_code="AST#1")
    ok = AssetUpdateRequest(asset_code="AST-1", combined_asset_number="CAN-1")
    assert ok.asset_code == "AST-1"
    assert ok.combined_asset_number == "CAN-1"


def test_update_request_empty_asset_code_is_explicit_clear() -> None:
    """Empty string normalizes to None but stays in fields_set so update can clear."""
    req = AssetUpdateRequest(asset_code="")
    assert req.asset_code is None
    assert "asset_code" in req.model_fields_set
    cleared = AssetUpdateRequest(asset_code=None)
    assert cleared.asset_code is None
    assert "asset_code" in cleared.model_fields_set
    omitted = AssetUpdateRequest(asset_name="Keep code")
    assert "asset_code" not in omitted.model_fields_set


def test_cleared_asset_code_stores_empty_string() -> None:
    """Mirror update_asset: NOT NULL column uses '' for a cleared Asset Number."""
    req = AssetUpdateRequest(asset_code="  ")
    assert req.asset_code is None
    stored = (req.asset_code or "").strip().upper()
    assert stored == ""

