"""Location code → display name resolution for transfer/disposal UIs."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from modules.asset_masters.location_lookup import (
    location_display_name,
    plant_code_display_map,
    resolve_plant_location_names,
    rewrite_audit_master_codes,
)


def test_location_display_name_prefers_name() -> None:
    assert location_display_name("Building A", "BLD-A") == "Building A"
    assert location_display_name("  ", "BLD-A") == "BLD-A"
    assert location_display_name(None, "BLD-A") == "BLD-A"
    assert location_display_name(None, None) is None


def test_location_display_name_skips_code_duplicate_name() -> None:
    assert location_display_name("BLD-A", "BLD-A", "Building A") == "Building A"
    assert location_display_name("bld-a", "BLD-A", "Building A") == "Building A"


def test_resolve_plant_location_names_uses_master_rows() -> None:
    fl = SimpleNamespace(id=10, code="FL-1", name="Line 1", description="Line 1", plant_id=1)
    al = SimpleNamespace(
        id=20, code="AL-1", name="Room 201", description="Room 201", functional_location_id=10
    )
    db = MagicMock()

    def scalar(stmt):  # noqa: ARG001
        # First call FL, second AL — approximate by call count
        scalar.calls = getattr(scalar, "calls", 0) + 1
        return fl if scalar.calls == 1 else al

    db.scalar.side_effect = scalar
    fl_name, al_name = resolve_plant_location_names(
        db,
        plant_id=1,
        functional_location_code="FL-1",
        actual_location_code="AL-1",
    )
    assert fl_name == "Line 1"
    assert al_name == "Room 201"


def test_rewrite_audit_master_codes_item_locations(monkeypatch) -> None:
    def fake_loc(db, *, plant_id, functional_location_code, actual_location_code=None):  # noqa: ARG001
        names = {"FL-QC": "QC Floor", "AL-QC-01": "QC Bay 1"}
        fl = names.get(functional_location_code or "", functional_location_code)
        al = names.get(actual_location_code or "") if actual_location_code else None
        return fl, al

    def fake_cc(db, *, plant_id, code):  # noqa: ARG001
        return {"CC-4200": "QC & Quality"}.get((code or "").strip(), code)

    monkeypatch.setattr(
        "modules.asset_masters.location_lookup.resolve_plant_location_names", fake_loc
    )
    monkeypatch.setattr(
        "modules.asset_masters.location_lookup.resolve_cost_center_name", fake_cc
    )
    rewritten = rewrite_audit_master_codes(
        MagicMock(),
        {
            "cost_center": "CC-4200",
            "item_locations": [
                {
                    "asset_code": "DEMO-AST-006",
                    "to_functional_location": "FL-QC",
                    "to_actual_location": "AL-QC-01",
                }
            ],
        },
        plant_id=1,
    )
    assert rewritten["cost_center"] == "QC & Quality"
    row = rewritten["item_locations"][0]
    assert row["to_functional_location"] == "QC Floor"
    assert row["to_actual_location"] == "QC Bay 1"
    assert row["asset_code"] == "DEMO-AST-006"


def test_plant_code_display_map_namespaces_colliding_fl_and_al_codes() -> None:
    fl = SimpleNamespace(id=1, code="WH-01", name="Warehouse A", description=None)
    al = SimpleNamespace(
        id=2, code="WH-01", name="Bay 1", description=None, functional_location_id=1
    )

    class _Rows:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    db = MagicMock()
    db.scalars.side_effect = [_Rows([fl]), _Rows([al]), _Rows([])]
    labels = plant_code_display_map(db, plant_id=1)
    assert labels["fl:wh-01"] == "Warehouse A"
    assert labels["al:wh-01"] == "Bay 1"
    assert labels["al:wh-01:wh-01"] == "Bay 1"
    assert "wh-01" not in labels
