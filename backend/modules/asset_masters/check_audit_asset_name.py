"""ponytail: receiver location audit rows must carry the asset name, old events included."""

from __future__ import annotations

from modules.asset_masters.location_lookup import rewrite_audit_master_codes


class _FakeDb:
    def scalar(self, stmt):
        return "Laptop" if "asset_master" in str(stmt) else None


def test_item_locations_get_asset_name() -> None:
    payload = {"item_locations": [{"asset_code": "A-1"}, {"asset_code": "A-2", "asset_name": "Kept"}]}
    out = rewrite_audit_master_codes(_FakeDb(), payload, plant_id=1)
    assert out["item_locations"][0]["asset_name"] == "Laptop"
    assert out["item_locations"][1]["asset_name"] == "Kept"


if __name__ == "__main__":
    test_item_locations_get_asset_name()
    print("ok")
