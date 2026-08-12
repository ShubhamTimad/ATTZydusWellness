"""Transfer/disposal list column filters expose distinct values from list-scoped orders."""

from __future__ import annotations

from modules.disposals.schema import (
    DisposalListFilterCostCenter,
    DisposalListFilterOptionsResponse,
    DisposalListFilterPlant,
)
from modules.transfers.schema import (
    TransferListFilterCostCenter,
    TransferListFilterOptionsResponse,
    TransferListFilterPlant,
)


def test_transfer_list_filter_options_schema() -> None:
    res = TransferListFilterOptionsResponse(
        plants=[TransferListFilterPlant(id=1, code="P1", name="Plant")],
        from_cost_centers=[
            TransferListFilterCostCenter(id=2, code="CC-A", name="From", plant_id=1)
        ],
        to_cost_centers=[
            TransferListFilterCostCenter(id=3, code="CC-B", name="To", plant_id=1)
        ],
        statuses=["draft", "closed"],
    )
    assert res.from_cost_centers[0].code == "CC-A"
    assert res.to_cost_centers[0].code == "CC-B"
    assert res.statuses == ["draft", "closed"]


def test_disposal_list_filter_options_schema() -> None:
    res = DisposalListFilterOptionsResponse(
        plants=[DisposalListFilterPlant(id=1, code="P1", name="Plant")],
        from_cost_centers=[
            DisposalListFilterCostCenter(id=2, code="CC-A", name="From", plant_id=1)
        ],
        statuses=["pending_approval"],
    )
    assert res.plants[0].id == 1
    assert res.statuses == ["pending_approval"]
