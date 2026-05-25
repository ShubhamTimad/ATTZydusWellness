#!/usr/bin/env python3
"""Remove imported assets and all approval/task inbox data.

Run from project root::

    ./venv/bin/python scripts/cleanup_imported_assets_and_tasks.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select, update

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.approvals.model import (
    ApprovalAction,
    ApprovalRequest,
    ApprovalTask,
    TaskAuditLog,
    TaskComment,
)
from modules.assets.lifecycle import APPROVAL_DRAFT, LIFECYCLE_INACTIVE
from modules.assets.model import AssetAuditEvent, AssetImportBatch, AssetMaster


def main() -> None:
    db = SessionLocal()
    try:
        imported_ids = list(
            db.scalars(
                select(AssetMaster.id).where(
                    AssetMaster.source_type == "import",
                    AssetMaster.deleted_at.is_(None),
                )
            ).all()
        )

        n_actions = db.execute(delete(ApprovalAction)).rowcount
        n_comments = db.execute(delete(TaskComment)).rowcount
        n_task_audit = db.execute(delete(TaskAuditLog)).rowcount
        n_tasks = db.execute(delete(ApprovalTask)).rowcount
        n_requests = db.execute(delete(ApprovalRequest)).rowcount

        n_asset_audit = 0
        if imported_ids:
            n_asset_audit = db.execute(
                delete(AssetAuditEvent).where(AssetAuditEvent.asset_id.in_(imported_ids))
            ).rowcount

        n_assets = db.execute(
            delete(AssetMaster).where(
                AssetMaster.source_type == "import",
                AssetMaster.deleted_at.is_(None),
            )
        ).rowcount

        n_batches = db.execute(delete(AssetImportBatch)).rowcount

        # Clear stale pending state on remaining manual assets (no open requests left).
        n_reset = db.execute(
            update(AssetMaster)
            .where(
                AssetMaster.deleted_at.is_(None),
                AssetMaster.approval_status.in_(("pending", "rejected")),
            )
            .values(
                lifecycle_status=LIFECYCLE_INACTIVE,
                approval_status=APPROVAL_DRAFT,
                approved_by=None,
            )
        ).rowcount

        db.commit()
        print("Cleanup complete:")
        print(f"  approval_actions deleted: {n_actions}")
        print(f"  task_comments deleted: {n_comments}")
        print(f"  task_audit_logs deleted: {n_task_audit}")
        print(f"  approval_tasks deleted: {n_tasks}")
        print(f"  approval_requests deleted: {n_requests}")
        print(f"  imported asset_audit_events deleted: {n_asset_audit}")
        print(f"  imported assets deleted: {n_assets}")
        print(f"  import_batches deleted: {n_batches}")
        print(f"  manual assets reset to inactive/draft: {n_reset}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
