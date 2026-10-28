"""Mark assets on received, confirmed, or closed transfer orders as active and approved.

Revision ID: 107
Revises: 106
Create Date: 2026-10-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "107"
down_revision = "106"
branch_labels = None
depends_on = None

_RECEIVED_TRANSFER_STATUSES = ("received_by_cc2", "confirmed_by_cf", "closed")
_HOLDING_TRANSFER_STATUSES = (
    "draft",
    "pending_approval",
    "assigned_to_cf",
    "approved_by_cf",
    "rejected",
    "in_rework",
)
_HOLDING_DISPOSAL_STATUSES = (
    "draft",
    "pending_approval",
    "pending_receipt",
    "rejected",
    "in_rework",
)


def upgrade() -> None:
    received = ", ".join(f"'{s}'" for s in _RECEIVED_TRANSFER_STATUSES)
    holding_transfer = ", ".join(f"'{s}'" for s in _HOLDING_TRANSFER_STATUSES)
    holding_disposal = ", ".join(f"'{s}'" for s in _HOLDING_DISPOSAL_STATUSES)
    op.execute(
        sa.text(
            f"""
            UPDATE asset_master
            SET lifecycle_status = 'active',
                approval_status = 'approved'
            WHERE deleted_at IS NULL
              AND lower(trim(lifecycle_status)) = 'pending_transfer'
              AND id IN (
                SELECT DISTINCT i.asset_id
                FROM asset_transfer_order_items i
                JOIN asset_transfer_orders o ON o.id = i.order_id
                WHERE o.status IN ({received})
              )
              AND id NOT IN (
                SELECT DISTINCT i2.asset_id
                FROM asset_transfer_order_items i2
                JOIN asset_transfer_orders o2 ON o2.id = i2.order_id
                WHERE o2.status IN ({holding_transfer})
              )
              AND id NOT IN (
                SELECT DISTINCT di.asset_id
                FROM asset_disposal_order_items di
                JOIN asset_disposal_orders do_ ON do_.id = di.order_id
                WHERE do_.status IN ({holding_disposal})
              )
            """
        )
    )


def downgrade() -> None:
    pass
