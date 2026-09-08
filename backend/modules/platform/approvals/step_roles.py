"""Extra approver roles on one workflow level. ``approver_role_id`` stays the first role."""

from __future__ import annotations

from sqlalchemy import and_, false, or_, select
from sqlalchemy.orm import Session, selectinload

from modules.platform.roles.model import Role
from modules.platform.users.model import User
from modules.rbac_association import approval_step_roles, user_role


def step_role_ids(step: object) -> list[int]:
    primary = getattr(step, "approver_role_id", None)
    ids: list[int] = []
    if primary is not None:
        ids.append(int(primary))
    for role in getattr(step, "approver_roles", None) or []:
        rid = int(role.id)
        if rid not in ids:
            ids.append(rid)
    return ids


def replace_step_roles(db: Session, step: object, role_ids: list[int]) -> list[int]:
    from modules.errors import NotFoundError

    seen: set[int] = set()
    ids: list[int] = []
    for raw in role_ids:
        n = int(raw)
        if n < 1 or n in seen:
            continue
        seen.add(n)
        ids.append(n)
    if not ids:
        raise ValueError("At least one role is required")
    for rid in ids:
        if db.get(Role, rid) is None:
            raise NotFoundError("Role", rid)
    step.approver_role_id = ids[0]  # type: ignore[attr-defined]
    step_id = getattr(step, "id", None)
    if step_id is None:
        db.flush()
        step_id = int(step.id)  # type: ignore[attr-defined]
    db.execute(
        approval_step_roles.delete().where(approval_step_roles.c.step_id == int(step_id))
    )
    db.execute(
        approval_step_roles.insert(),
        [{"step_id": int(step_id), "role_id": rid} for rid in ids],
    )
    return ids


def users_in_any_role(db: Session, role_ids: list[int]) -> list[User]:
    ids = [int(rid) for rid in role_ids if int(rid) > 0]
    if not ids:
        return []
    return list(
        db.scalars(
            select(User)
            .select_from(user_role)
            .join(User, User.id == user_role.c.user_id)
            .where(user_role.c.role_id.in_(ids), User.is_active.is_(True))
            .options(selectinload(User.cost_centers), selectinload(User.org_units))
            .order_by(User.full_name.asc(), User.id.asc())
        )
        .unique()
        .all()
    )


def role_names_label(db: Session, role_ids: list[int]) -> str:
    names: list[str] = []
    for rid in role_ids:
        role = db.get(Role, int(rid))
        if role is not None and role.name:
            names.append(str(role.name))
    return ", ".join(names) if names else "Approvers"


def picker_role_ids(db: Session, role_id: int, step: object | None = None) -> list[int]:
    """Roles for an assignee picker. A known step wins; otherwise expand that role's levels."""
    if step is not None:
        ids = step_role_ids(step)
        return ids or [int(role_id)]
    step_ids = [
        int(row[0])
        for row in db.execute(
            select(approval_step_roles.c.step_id).where(
                approval_step_roles.c.role_id == int(role_id)
            )
        ).all()
    ]
    if not step_ids:
        return [int(role_id)]
    ids: list[int] = []
    seen: set[int] = set()
    for raw in db.execute(
        select(approval_step_roles.c.role_id).where(
            approval_step_roles.c.step_id.in_(step_ids)
        )
    ).all():
        rid = int(raw[0])
        if rid in seen:
            continue
        seen.add(rid)
        ids.append(rid)
    return ids or [int(role_id)]


def user_matches_role_task(db: Session, task: object, user_role_ids: set[int]) -> bool:
    if getattr(task, "assigned_user_id", None) is not None:
        return False
    assigned = getattr(task, "assigned_role_id", None)
    if assigned is None:
        return False
    if int(assigned) in user_role_ids:
        return True
    step_id = getattr(task, "step_id", None)
    if step_id is None or not user_role_ids:
        return False
    hit = db.scalar(
        select(approval_step_roles.c.step_id).where(
            approval_step_roles.c.step_id == int(step_id),
            approval_step_roles.c.role_id.in_(list(user_role_ids)),
        )
    )
    return hit is not None


def role_pool_task_clause(user_role_ids: set[int] | list[int]):
    """Pending role-pool tasks the viewer may act on (primary role or any extra level role)."""
    ids = [int(rid) for rid in user_role_ids]
    if not ids:
        return false()
    from modules.platform.approvals.model import ApprovalTask

    extra_steps = select(approval_step_roles.c.step_id).where(
        approval_step_roles.c.role_id.in_(ids)
    )
    return and_(
        ApprovalTask.assigned_user_id.is_(None),
        ApprovalTask.assigned_role_id.is_not(None),
        or_(
            ApprovalTask.assigned_role_id.in_(ids),
            ApprovalTask.step_id.in_(extra_steps),
        ),
    )
