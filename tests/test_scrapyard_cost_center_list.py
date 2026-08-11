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


def _sql(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


def test_scrapyard_only_does_not_filter_to_assigned_cost_centers() -> None:
    svc, stmts = _svc_with_scope()
    svc.list_cost_centers(plant_id=1, scrapyard_only=True, viewer_user_id=7)
    sql = _sql(stmts[0])
    assert "99" not in sql
    assert "is_scrapyard" in sql.lower()


def test_regular_cost_center_list_still_filters_to_assigned() -> None:
    svc, stmts = _svc_with_scope()
    svc.list_cost_centers(plant_id=1, scrapyard_only=False, viewer_user_id=7)
    sql = _sql(stmts[0])
    assert "99" in sql
