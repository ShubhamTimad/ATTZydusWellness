"""Viewer plant / cost-center data scope for operators.

Rules:
- Superuser → unrestricted.
- Assigned plants → restrict to those plants.
- Assigned cost centers → restrict to those (plant_id, code) / ids.
- Cost center is optional: plant-only operators see all CCs in their plants.
- Empty plant + empty CC assignment → unrestricted (legacy admins / unset).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.platform.users.model import User


@dataclass(frozen=True)
class ViewerOrgScope:
    """None on a field means unrestricted for that dimension."""

    plant_ids: frozenset[int] | None
    # (plant_id, cost_center_code) for asset financial string match
    cost_center_keys: frozenset[tuple[int, str]] | None
    cost_center_ids: frozenset[int] | None

    @property
    def unrestricted(self) -> bool:
        return self.plant_ids is None and self.cost_center_keys is None


def load_viewer_org_scope(db: Session, user_id: int | None) -> ViewerOrgScope:
    if user_id is None:
        return ViewerOrgScope(None, None, None)
    user = db.scalar(
        select(User)
        .where(User.id == int(user_id))
        .options(selectinload(User.org_units), selectinload(User.cost_centers))
    )
    if user is None or bool(user.is_superuser):
        return ViewerOrgScope(None, None, None)

    plant_ids = frozenset(int(p.id) for p in (user.org_units or []))
    ccs = list(user.cost_centers or [])

    plant_scope: frozenset[int] | None = plant_ids if plant_ids else None

    if not ccs:
        return ViewerOrgScope(plant_scope, None, None)

    keys: set[tuple[int, str]] = set()
    ids: set[int] = set()
    for cc in ccs:
        code = (cc.code or "").strip()
        if not code:
            continue
        pid = int(cc.plant_id)
        if plant_scope is not None and pid not in plant_scope:
            continue
        keys.add((pid, code))
        ids.add(int(cc.id))

    # Assigned CCs that don't match plant scope → empty (see nothing in CC dimension).
    return ViewerOrgScope(
        plant_scope,
        frozenset(keys),
        frozenset(ids),
    )


def effective_plant_id(scope: ViewerOrgScope, requested: int | None) -> int | None | object:
    """Return plant filter to apply, or a sentinel empty result.

    Returns:
      - requested plant if allowed
      - None if unrestricted / no plant filter needed beyond scope
      - scope.plant_ids when request omitted and plants are scoped (caller should use .in_)
      - False when requested plant is outside scope (caller should return empty)
    """
    if requested is not None:
        if scope.plant_ids is not None and int(requested) not in scope.plant_ids:
            return False
        if scope.cost_center_keys is not None:
            allowed_plants = {pid for pid, _ in scope.cost_center_keys}
            if allowed_plants and int(requested) not in allowed_plants:
                return False
        return int(requested)
    return None
