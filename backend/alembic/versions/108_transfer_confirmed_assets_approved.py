"""Mark assets on confirmed or closed transfer orders as active and approved.

Assets on pre-confirm transfer orders (including received_by_cc2) remain pending_transfer.

Revision ID: 108
Revises: 107
Create Date: 2026-10-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "108"
down_revision = "107"
branch_labels = None
depends_on = None

_CONFIRMED_TRANSFER_STATUSES = ("confirmed_by_cf", "closed")
_PRE_CONFIRM_TRANSFER_STATUSES = (
    "draft",
    "pending_approval",
    "assigned_to_cf",
    "approved_by_cf",
    "received_by_cc2",
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
    confirmed = ", ".join(f"'{s}'" for s in _CONFIRMED_TRANSFER_STATUSES)
    pre_confirm = ", ".join(f"'{s}'" for s in _PRE_CONFIRM_TRANSFER_STATUSES)
    holding_disposal = ", ".join(f"'{s}'" for s in _HOLDING_DISPOSAL_STATUSES)

    # 1. Assets currently on an open pre-confirm transfer (including received_by_cc2):
    # keep/set them as pending_transfer.
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
                WHERE o.status IN ({pre_confirm})
              )
            """
        )
    )

    # 2. Assets on confirmed or closed transfers (and not held by any open transfer or disposal):
    # mark them as active and approved.
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
                WHERE o.status IN ({confirmed})
              )
              AND id NOT IN (
                SELECT DISTINCT i2.asset_id
                FROM asset_transfer_order_items i2
                JOIN asset_transfer_orders o2 ON o2.id = i2.order_id
                WHERE o2.status IN ({pre_confirm})
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
