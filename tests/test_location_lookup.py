"""Location code → display name resolution for transfer/disposal UIs."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from modules.asset_masters.location_lookup import (
    location_display_name,
    resolve_plant_location_names,
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
