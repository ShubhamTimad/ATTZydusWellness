"""Backfill pending_transfer on assets already sitting on open transfer orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None

_OPEN_TRANSFER_STATUSES = (
    "draft",
    "pending_approval",
    "assigned_to_cf",
    "rejected",
    "in_rework",
    "approved_by_cf",
    "received_by_cc2",
    "confirmed_by_cf",
)


def upgrade() -> None:
    statuses = ", ".join(f"'{s}'" for s in _OPEN_TRANSFER_STATUSES)
    op.execute(
        sa.text(
            f"""
            UPDATE asset_master
            SET lifecycle_status = 'pending_transfer'
            WHERE deleted_at IS NULL
              AND lower(trim(lifecycle_status)) = 'active'
              AND id IN (
                SELECT DISTINCT i.asset_id
                FROM asset_transfer_order_items i
                JOIN asset_transfer_orders o ON o.id = i.order_id
                WHERE o.status IN ({statuses})
              )
            """
        )
    )


def downgrade() -> None:
    # Cannot tell backfilled rows from orders created after pending_transfer shipped.
    pass
