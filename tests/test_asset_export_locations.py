"""Asset register export shows location names, not stored codes."""

from __future__ import annotations

from types import SimpleNamespace

from modules.assets.export import asset_export_value


def _asset(*, plant_id=1, functional_location="1", actual_location="2"):
    loc = SimpleNamespace(
        plant_id=plant_id,
        functional_location=functional_location,
        actual_location=actual_location,
        sub_location=None,
        plant=SimpleNamespace(code="ZT001", name="ZYDUS_TAKEDA"),
    )
    return SimpleNamespace(
        location=loc,
        financial=None,
        inventory=None,
        category=None,
        tag_color=None,
        asset_custodian=None,
        asset_condition=None,
        asset_class_master=None,
        information=None,
        asset_name="Chair",
        asset_class=None,
        asset_type=None,
        asset_code="A1",
        combined_asset_number=None,
        remark=None,
        sub_no=None,
        rfid_code=None,
        serial_no=None,
        lifecycle_status=None,
        approval_status=None,
        source_type=None,
    )


def test_export_uses_actual_location_names() -> None:
    asset = _asset()
    fl_desc = {(1, "1"): "Production Floor"}
    al_desc = {(1, "1", "2"): "Reactor Bay"}
    assert (
        asset_export_value(asset, "functional_location", fl_desc=fl_desc, al_desc=al_desc)
        == "Production Floor"
    )
    assert (
        asset_export_value(asset, "actual_location", fl_desc=fl_desc, al_desc=al_desc)
        == "Reactor Bay"
    )


def test_export_falls_back_to_code_when_name_missing() -> None:
    asset = _asset()
    assert asset_export_value(asset, "functional_location") == "1"
    assert asset_export_value(asset, "actual_location") == "2"
