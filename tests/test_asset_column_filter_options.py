"""Asset list column filters expose distinct values from list-scoped assets."""

from __future__ import annotations

from modules.assets.schema import AssetListFilterOption, AssetListFilterOptionsResponse


def test_asset_list_filter_options_schema() -> None:
    res = AssetListFilterOptionsResponse(
        cost_centers=[AssetListFilterOption(code="CC-4168", name="One")],
        functional_locations=[AssetListFilterOption(code="FL-1", name=None)],
        actual_locations=[],
    )
    assert [c.code for c in res.cost_centers] == ["CC-4168"]
    assert res.functional_locations[0].name is None
    assert res.actual_locations == []
