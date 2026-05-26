from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import get_flat_permission_codes_for_user
from db.session import get_db
from modules.platform.approvals.model import ApprovalTask
from modules.assets.model import (
    AssetCategory,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.rbac_association import user_role
from modules.platform.roles.model import Role
from modules.platform.org_units.model import OrgUnit
from modules.platform.users.model import User


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _variants(code: str) -> set[str]:
    v = {code}
    if "." in code:
        v.add(code.replace(".", ":", 1))
    if ":" in code:
        v.add(code.replace(":", ".", 1))
    return v


def _has(grants: set[str], code: str) -> bool:
    return not grants.isdisjoint(_variants(code))


def _has_any(grants: set[str], *codes: str) -> bool:
    for c in codes:
        if _has(grants, c):
            return True
    return False


@router.get("/summary")
def get_dashboard_summary(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """
    Dynamic dashboard summary. Modules are enabled based on the caller's permission snapshot.
    """
    user_id = int(current.subject)
    grants = set(get_flat_permission_codes_for_user(db, user_id))

    has_users = _has(grants, "users.view")
    # UI currently gates tasks by `approval.view`, but backend tasks are under `task.*`.
    has_tasks = _has_any(grants, "approval.view", "task.view")
    has_assets = _has_any(
        grants,
        "asset.view",
        "asset.create",
        "asset.import",
        "asset.manage",
    )

    modules: dict[str, Any] = {}

    if has_users:
        total_users = int(db.scalar(select(func.count()).select_from(User)) or 0)
        active_users = int(db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0)
        inactive_users = total_users - active_users

        seven_days_ago = date.today() - timedelta(days=6)
        new_last_7_days = int(
            db.scalar(select(func.count()).select_from(User).where(func.date(User.created_at) >= seven_days_ago)) or 0
        )

        users_by_role_rows = db.execute(
            select(Role.name, func.count(func.distinct(user_role.c.user_id)))
            .select_from(user_role)
            .join(Role, Role.id == user_role.c.role_id)
            .group_by(Role.name)
            .order_by(Role.name.asc())
        ).all()
        users_by_role = [{"role": str(name), "count": int(cnt)} for name, cnt in users_by_role_rows]

        modules["users"] = {
            "total_users": total_users,
            "active_users": active_users,
            "inactive_users": inactive_users,
            "new_users_last_7_days": new_last_7_days,
            "users_by_role": users_by_role,
        }

    if has_tasks:
        # Viewer-scoped status stats for inbox
        base = (
            select(ApprovalTask.status, func.count())
            .select_from(ApprovalTask)
            .where((ApprovalTask.assigned_to_user_id == user_id) | (ApprovalTask.assigned_user_id == user_id))
            .group_by(ApprovalTask.status)
        )
        rows = db.execute(base).all()
        by_status: dict[str, int] = {str(s): int(c) for s, c in rows if s is not None}
        modules["tasks"] = {
            "pending": by_status.get("pending", 0),
            "approved": by_status.get("approved", 0),
            "rejected": by_status.get("rejected", 0),
            # "Completed" should reflect finished work:
            # - approval tasks: approved
            # - manual tasks: completed / closed
            "completed": by_status.get("approved", 0) + by_status.get("completed", 0) + by_status.get("closed", 0),
        }

    if has_assets:
        asset_base = select(AssetMaster).where(AssetMaster.deleted_at.is_(None))
        total_assets = int(db.scalar(select(func.count()).select_from(asset_base.subquery())) or 0)
        pending_approvals = int(
            db.scalar(
                select(func.count())
                .select_from(AssetMaster)
                .where(
                    AssetMaster.deleted_at.is_(None),
                    AssetMaster.approval_status == "pending",
                )
            )
            or 0
        )
        mismatch = int(
            db.scalar(
                select(func.count())
                .select_from(AssetInventoryInformation)
                .join(AssetMaster, AssetMaster.id == AssetInventoryInformation.asset_id)
                .where(
                    AssetMaster.deleted_at.is_(None),
                    AssetInventoryInformation.inventory_count.isnot(None),
                    AssetInventoryInformation.physical_count.isnot(None),
                    AssetInventoryInformation.inventory_count != AssetInventoryInformation.physical_count,
                )
            )
            or 0
        )
        seven_days_ago = date.today() - timedelta(days=6)
        recent = int(
            db.scalar(
                select(func.count())
                .select_from(AssetMaster)
                .where(
                    AssetMaster.deleted_at.is_(None),
                    func.date(AssetMaster.created_at) >= seven_days_ago,
                )
            )
            or 0
        )
        by_cat_rows = db.execute(
            select(AssetCategory.name, func.count())
            .select_from(AssetMaster)
            .join(AssetCategory, AssetCategory.id == AssetMaster.asset_category_id, isouter=True)
            .where(AssetMaster.deleted_at.is_(None))
            .group_by(AssetCategory.name)
            .order_by(func.count().desc())
        ).all()
        by_plant_rows = db.execute(
            select(OrgUnit.name, func.count())
            .select_from(AssetLocationInformation)
            .join(AssetMaster, AssetMaster.id == AssetLocationInformation.asset_id)
            .join(OrgUnit, OrgUnit.id == AssetLocationInformation.plant_id, isouter=True)
            .where(AssetMaster.deleted_at.is_(None))
            .group_by(OrgUnit.name)
            .order_by(func.count().desc())
        ).all()
        modules["assets"] = {
            "total_assets": total_assets,
            "pending_approvals": pending_approvals,
            "inventory_mismatch": mismatch,
            "recently_added": recent,
            "by_category": [{"category": str(n or "Uncategorized"), "count": int(c)} for n, c in by_cat_rows],
            "by_plant": [{"plant": str(n or "Unassigned"), "count": int(c)} for n, c in by_plant_rows],
        }

    return {"modules": modules}

