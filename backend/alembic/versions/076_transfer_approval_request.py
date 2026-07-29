"""Add approval_request_id to asset transfer orders; migrate assigned_to_cf → pending_approval."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_transfer_orders",
        sa.Column(
            "approval_request_id",
            sa.Integer(),
            sa.ForeignKey("approval_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute(
        "UPDATE asset_transfer_orders SET status = 'pending_approval' "
        "WHERE status = 'assigned_to_cf'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE asset_transfer_orders SET status = 'assigned_to_cf' "
        "WHERE status = 'pending_approval' AND approval_request_id IS NULL"
    )
    op.drop_column("asset_transfer_orders", "approval_request_id")
