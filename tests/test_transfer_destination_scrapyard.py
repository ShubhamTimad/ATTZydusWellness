"""Transfer destination must not include scrapyard cost centers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from modules.errors import ConflictError
from modules.transfers.service import TransferOrderService


def test_destination_list_excludes_scrapyard_cost_centers() -> None:
    svc = TransferOrderService(MagicMock())
    svc._db.get.return_value = SimpleNamespace(type="PLANT")
    stmts: list = []

    def scalars(stmt):
        stmts.append(stmt)
        result = MagicMock()
        result.all.return_value = []
        return result

    svc._db.scalars = scalars
    svc.list_destination_cost_centers(plant_id=1)
    sql = str(stmts[0].compile(compile_kwargs={"literal_binds": True})).lower()
    assert "is_scrapyard" in sql


def test_destination_assert_rejects_scrapyard() -> None:
    svc = TransferOrderService(MagicMock())
    with pytest.raises(ConflictError, match="Scrapyard"):
        svc._assert_destination_differs(
            [],
            SimpleNamespace(code="SCRAP", is_scrapyard=True),  # type: ignore[arg-type]
        )
