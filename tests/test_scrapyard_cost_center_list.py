"""Scrapyard destination CCs are listed for the plant, not only the viewer's assigned CCs."""

from __future__ import annotations

from unittest.mock import MagicMock

from modules.asset_masters.service import AssetMastersService
from modules.platform.users.scope import ViewerOrgScope


def _svc_with_scope() -> tuple[AssetMastersService, list]:
    stmts: list = []
    svc = AssetMastersService(MagicMock())
    svc._viewer_scope = lambda _uid: ViewerOrgScope(  # type: ignore[method-assign]
        plant_ids=frozenset({1}),
        cost_center_keys=frozenset({(1, "CC-OWN")}),
        cost_center_ids=frozenset({99}),
    )

    def scalars(stmt):
        stmts.append(stmt)
        result = MagicMock()
        result.all.return_value = []
        return result

    svc._db.scalars = scalars
    return svc, stmts


def _where_sql(stmt) -> str:
    return " ".join(str(clause) for clause in stmt._where_criteria)


def _filters_to_assigned_ids(stmt) -> bool:
    return "cost_center_masters.id IN" in _where_sql(stmt)


def test_scrapyard_only_does_not_filter_to_assigned_cost_centers() -> None:
    svc, stmts = _svc_with_scope()
    svc.list_cost_centers(plant_id=1, scrapyard_only=True, viewer_user_id=7)
    sql = _where_sql(stmts[0]).lower()
    assert not _filters_to_assigned_ids(stmts[0])
    assert "is_scrapyard" in sql


def test_regular_cost_center_list_still_filters_to_assigned() -> None:
    svc, stmts = _svc_with_scope()
    svc.list_cost_centers(plant_id=1, scrapyard_only=False, viewer_user_id=7)
    assert _filters_to_assigned_ids(stmts[0])


def test_asset_list_filter_uses_plant_not_assigned() -> None:
    svc, stmts = _svc_with_scope()
    svc.list_cost_centers(
        plant_id=1,
        scrapyard_only=False,
        for_asset_list=True,
        viewer_user_id=7,
    )
    sql = _where_sql(stmts[0]).lower()
    assert not _filters_to_assigned_ids(stmts[0])
    assert "plant_id" in sql
