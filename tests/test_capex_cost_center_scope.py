"""The CapEx form's cost center narrows the approver pool it offers."""

from __future__ import annotations

from types import SimpleNamespace

from modules.capex.constants import ENTITY_TYPE, ENTITY_TYPE_WITH_ENGINEERING
from modules.platform.approvals.org_scope import (
    entity_cost_center_ids,
    filter_users_by_cost_center,
)


def _user(name: str, *cost_center_ids: int):
    return SimpleNamespace(
        full_name=name,
        cost_centers=[SimpleNamespace(id=cc) for cc in cost_center_ids],
    )


class _FakeDb:
    """db.get(Model, id) is the only call entity_cost_center_ids makes."""

    def __init__(self, row) -> None:
        self._row = row

    def get(self, _model, _pk):
        return self._row


def test_pool_keeps_matching_and_plant_wide_users() -> None:
    mapped = _user("Mapped", 5)
    other = _user("Other", 6)
    plant_wide = _user("Plant wide")
    pool = [mapped, other, plant_wide]

    assert filter_users_by_cost_center(pool, cost_center_id=5) == [mapped, plant_wide]
    # No cost center on the form → no narrowing at all.
    assert filter_users_by_cost_center(pool, cost_center_id=None) == pool


def test_capex_entity_resolves_its_cost_center_for_org_scoped_steps() -> None:
    db = _FakeDb(SimpleNamespace(cost_center_id=42))
    for entity_type in (ENTITY_TYPE, ENTITY_TYPE_WITH_ENGINEERING):
        assert entity_cost_center_ids(db, entity_type=entity_type, entity_id=1) == (42, 42)


def test_capex_without_cost_center_stays_unscoped() -> None:
    db = _FakeDb(SimpleNamespace(cost_center_id=None))
    assert entity_cost_center_ids(db, entity_type=ENTITY_TYPE, entity_id=1) == (None, None)
