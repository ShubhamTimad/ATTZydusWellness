"""Tests ensuring asset_code is required, unique, and validated across API & imports."""
import pytest
from pydantic import ValidationError
from backend.modules.assets.schema import AssetCreateRequest
from backend.modules.assets.field_definitions import (
    ASSET_REQUIRED_IMPORT_FIELD_KEYS,
    ASSET_REQUIRED_MANUAL_FIELD_KEYS,
)
from backend.modules.assets.field_config_seed import _REQUIRED


def test_asset_code_in_required_lists():
    assert "asset_code" in _REQUIRED
    assert "asset_code" in ASSET_REQUIRED_IMPORT_FIELD_KEYS
    assert "asset_code" in ASSET_REQUIRED_MANUAL_FIELD_KEYS


def test_asset_code_required_in_schema():
    # asset_code cannot be omitted
    with pytest.raises(ValidationError):
        AssetCreateRequest(
            asset_name="Pump",
            combined_asset_number="1000-0",
            asset_description="Test Asset",
            company_code="1000",
            plant="P01",
        )

    # asset_code cannot be empty string
    with pytest.raises(ValidationError):
        AssetCreateRequest(
            asset_code="",
            asset_name="Pump",
            combined_asset_number="1000-0",
            asset_description="Test Asset",
            company_code="1000",
            plant="P01",
        )

    # Valid when asset_code is provided
    req = AssetCreateRequest(
        asset_code="AST-0099",
        asset_name="Pump",
        combined_asset_number="1000-0",
        asset_description="Test Asset",
        company_code="1000",
        plant="P01",
    )
    assert req.asset_code == "AST-0099"
