"""Self-check: disposal is blocked for assets on an active physical verification order.

Usage (from backend/): ../.venv/bin/python check_disposal_pvo_block.py
"""
from modules.capex.service import *  # noqa: F401,F403  (register all mappers)
from modules.orders.service import *  # noqa: F401,F403
from modules.transfers.service import *  # noqa: F401,F403
from modules.assets.service import *  # noqa: F401,F403
from modules.disposals.service import DisposalOrderService

from sqlalchemy import select

from db.session import SessionLocal
from modules.assets.model import AssetMaster
from modules.errors import ConflictError
from modules.orders.conflicts import order_conflict_block_clause
from modules.orders.model import PhysicalOrder, PhysicalOrderItem

db = SessionLocal()
svc = DisposalOrderService(db)
held_ids = (
    select(PhysicalOrderItem.asset_id)
    .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
    .where(order_conflict_block_clause())
)
eligible = select(AssetMaster).where(
    AssetMaster.deleted_at.is_(None),
    AssetMaster.lifecycle_status == "active",
    AssetMaster.approval_status == "approved",
)

free = db.scalars(eligible.where(~AssetMaster.id.in_(held_ids)).limit(1)).first()
assert free is not None, "no free asset to test"
svc._assert_assets_disposable([free])
print("OK allowed:", free.asset_code)

held = db.scalars(select(AssetMaster).where(AssetMaster.id.in_(held_ids)).limit(1)).first()
assert held is not None, "no asset on an active PVO to test"
# Force it eligible so only the PVO rule can reject it; rolled back below.
held.lifecycle_status, held.approval_status = "active", "approved"
try:
    svc._assert_assets_disposable([held])
    raise AssertionError(f"{held.asset_code} should be blocked")
except ConflictError as e:
    assert "Physical Verification Order" in str(e), e
    print("OK blocked:", e)
finally:
    db.rollback()
