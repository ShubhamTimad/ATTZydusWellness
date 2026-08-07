"""Org scope for approval step assignee pools (source / destination / all).

Blank / null / \"none\" org_scope → all active users in the step role.
source / destination → role users also assigned to that cost center on the order.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from modules.errors import ConflictError
from modules.orders.service import user_in_cost_center_scope
from modules.platform.users.model import User
from modules.rbac_association import user_role

ORG_SCOPE_SOURCE = "source"
ORG_SCOPE_DESTINATION = "destination"
_VALID = frozenset({ORG_SCOPE_SOURCE, ORG_SCOPE_DESTINATION})


def normalize_org_scope(raw: str | None) -> str | None:
    """Return 'source' | 'destination' | None (None = no CC filter / all role users)."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s in ("none", "all", "blank"):
        return None
    if s not in _VALID:
        raise ConflictError("org_scope must be blank, source, or destination.")
    return s


def resolve_scoped_cost_center_id(
    org_scope: str | None,
    *,
    source_cost_center_id: int | None,
    destination_cost_center_id: int | None,
) -> int | None:
    """Map step org_scope + order CCs → cost_center_id to filter on.

    None org_scope → None (no filter).
    Scoped but missing CC on the order → ConflictError.
    """
    scope = normalize_org_scope(org_scope)
    if scope is None:
        return None
    if scope == ORG_SCOPE_SOURCE:
        if source_cost_center_id is None:
            raise ConflictError(
                "This workflow step is scoped to the source cost center, "
                "but the order has no source cost center."
            )
        return int(source_cost_center_id)
    if destination_cost_center_id is None:
        raise ConflictError(
            "This workflow step is scoped to the destination cost center, "
            "but the order has no destination cost center."
        )
    return int(destination_cost_center_id)


def users_in_role(db: Session, role_id: int) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .select_from(user_role)
            .join(User, User.id == user_role.c.user_id)
            .where(user_role.c.role_id == int(role_id), User.is_active.is_(True))
            .options(selectinload(User.cost_centers), selectinload(User.org_units))
            .order_by(User.full_name.asc(), User.id.asc())
        ).all()
    )


def user_matches_cost_center(user: User, cost_center_id: int) -> bool:
    return user_in_cost_center_scope(
        assigned_cost_center_ids={int(cc.id) for cc in (user.cost_centers or [])},
        cost_center_id=int(cost_center_id),
    )


def filter_users_by_cost_center(
    users: list[User], *, cost_center_id: int | None
) -> list[User]:
    if cost_center_id is None:
        return users
    return [u for u in users if user_matches_cost_center(u, int(cost_center_id))]


def entity_cost_center_ids(
    db: Session, *, entity_type: str, entity_id: int
) -> tuple[int | None, int | None]:
    """Return (source_cost_center_id, destination_cost_center_id) for an approval entity."""
    et = (entity_type or "").strip()
    eid = int(entity_id)

    from modules.disposals.constants import DISPOSAL_ENTITY_TYPES
    from modules.transfers.constants import TRANSFER_ENTITY_TYPES

    if et in TRANSFER_ENTITY_TYPES:
        from modules.transfers.model import AssetTransferOrder

        order = db.get(AssetTransferOrder, eid)
        if order is None:
            return None, None
        src = int(order.from_cost_center_id) if order.from_cost_center_id else None
        dst = int(order.to_cost_center_id) if order.to_cost_center_id else None
        return src, dst

    if et in DISPOSAL_ENTITY_TYPES:
        from modules.disposals.model import AssetDisposalOrder

        order = db.get(AssetDisposalOrder, eid)
        if order is None:
            return None, None
        src = int(order.from_cost_center_id) if order.from_cost_center_id else None
        dst = int(order.to_cost_center_id) if order.to_cost_center_id else None
        return src, dst

    return None, None


def cost_center_id_for_step(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    org_scope: str | None,
) -> int | None:
    src, dst = entity_cost_center_ids(db, entity_type=entity_type, entity_id=entity_id)
    return resolve_scoped_cost_center_id(
        org_scope,
        source_cost_center_id=src,
        destination_cost_center_id=dst,
    )


def check_org_scope() -> None:
    assert normalize_org_scope(None) is None
    assert normalize_org_scope("") is None
    assert normalize_org_scope("none") is None
    assert normalize_org_scope("SOURCE") == "source"
    assert normalize_org_scope("destination") == "destination"
    assert (
        resolve_scoped_cost_center_id(None, source_cost_center_id=1, destination_cost_center_id=2)
        is None
    )
    assert (
        resolve_scoped_cost_center_id(
            "source", source_cost_center_id=10, destination_cost_center_id=20
        )
        == 10
    )
    assert (
        resolve_scoped_cost_center_id(
            "destination", source_cost_center_id=10, destination_cost_center_id=20
        )
        == 20
    )
    try:
        resolve_scoped_cost_center_id(
            "destination", source_cost_center_id=10, destination_cost_center_id=None
        )
        raise AssertionError("expected ConflictError")
    except ConflictError:
        pass
    # Disposal destination uses order.to_cost_center_id (scrapyard), same as transfer to_cc.
    assert (
        resolve_scoped_cost_center_id(
            "destination", source_cost_center_id=1, destination_cost_center_id=99
        )
        == 99
    )


if __name__ == "__main__":
    check_org_scope()
    print("org_scope ok")
