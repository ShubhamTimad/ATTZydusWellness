"""Self-check: CapEx forms can only be saved with a cost center the actor can see.

Usage (from backend/): ../.venv/bin/python check_capex_cost_center_scope.py
"""
from modules.orders.service import *  # noqa: F401,F403  (register all mappers)
from modules.transfers.service import *  # noqa: F401,F403
from modules.assets.service import *  # noqa: F401,F403
from modules.capex.service import CapexFormService

from sqlalchemy import select

from db.session import SessionLocal
from modules.asset_masters.model import CostCenterMaster
from modules.errors import ConflictError
from modules.platform.users.model import User
from modules.platform.users.scope import load_viewer_org_scope

db = SessionLocal()
svc = CapexFormService(db)

scoped = next(
    (
        (u, s)
        for u in db.scalars(select(User).where(User.is_superuser.is_(False)))
        if (s := load_viewer_org_scope(db, int(u.id))).cost_center_ids
    ),
    None,
)
assert scoped is not None, "no user with assigned cost centers to test"
user, scope = scoped
uid = int(user.id)
active = select(CostCenterMaster).where(CostCenterMaster.is_active.is_(True))

inside = db.scalars(active.where(CostCenterMaster.id.in_(scope.cost_center_ids))).first()
assert inside is not None
assert svc._validated_cost_center_id(int(inside.id), actor_user_id=uid) == int(inside.id)
print("OK allowed:", user.email, inside.code)

for label, cc_id in (
    ("none", None),
    ("outside", (o := db.scalars(active.where(~CostCenterMaster.id.in_(scope.cost_center_ids))).first()) and int(o.id)),
):
    if label == "outside" and cc_id is None:
        print("SKIP outside: every active cost center is in scope")
        continue
    try:
        svc._validated_cost_center_id(cc_id, actor_user_id=uid)
        raise AssertionError(f"{label} cost center should be rejected for {user.email}")
    except ConflictError as e:
        print(f"OK blocked {label}:", e)

db.rollback()
