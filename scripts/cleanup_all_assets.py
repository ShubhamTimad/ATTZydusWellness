#!/usr/bin/env python3
"""Remove every asset and related operational data (orders, import batches, approvals).

Run from project root::

    python3 scripts/cleanup_all_assets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, func, select

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.platform.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalTask,
    TaskAuditLog,
    TaskComment,
)
from modules.assets.model import AssetAuditEvent, AssetImportBatch, AssetMaster
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit, PhysicalOrderItem


def main() -> None:
    db = SessionLocal()
    try:
        asset_count = db.scalar(select(func.count()).select_from(AssetMaster)) or 0

        n_actions = db.execute(delete(ApprovalAction)).rowcount
        n_comments = db.execute(delete(TaskComment)).rowcount
        n_task_audit = db.execute(delete(TaskAuditLog)).rowcount
        n_tasks = db.execute(delete(ApprovalTask)).rowcount
        n_requests = db.execute(delete(ApprovalRequest)).rowcount

        n_order_audit = db.execute(delete(PhysicalOrderAudit)).rowcount
        n_order_items = db.execute(delete(PhysicalOrderItem)).rowcount
        n_orders = db.execute(delete(PhysicalOrder)).rowcount

        n_asset_audit = db.execute(delete(AssetAuditEvent)).rowcount
        n_assets = db.execute(delete(AssetMaster)).rowcount
        n_batches = db.execute(delete(AssetImportBatch)).rowcount

        db.commit()
        print("All assets cleanup complete:")
        print(f"  assets before cleanup: {asset_count}")
        print(f"  approval_actions deleted: {n_actions}")
        print(f"  task_comments deleted: {n_comments}")
        print(f"  task_audit_logs deleted: {n_task_audit}")
        print(f"  approval_tasks deleted: {n_tasks}")
        print(f"  approval_requests deleted: {n_requests}")
        print(f"  physical_order_audit deleted: {n_order_audit}")
        print(f"  physical_order_items deleted: {n_order_items}")
        print(f"  physical_orders deleted: {n_orders}")
        print(f"  asset_audit_events deleted: {n_asset_audit}")
        print(f"  assets deleted: {n_assets}")
        print(f"  import_batches deleted: {n_batches}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
