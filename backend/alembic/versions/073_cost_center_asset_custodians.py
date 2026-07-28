"""Cost center asset custodians mapping."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "073"
down_revision = "072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cost_center_asset_custodians",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "cost_center_id",
            sa.Integer(),
            sa.ForeignKey("cost_center_masters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "cost_center_id",
            "user_id",
            name="uq_cost_center_asset_custodians_cc_user",
        ),
    )
    op.create_index(
        "ix_cost_center_asset_custodians_cost_center_id",
        "cost_center_asset_custodians",
        ["cost_center_id"],
    )
    op.create_index(
        "ix_cost_center_asset_custodians_user_id",
        "cost_center_asset_custodians",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cost_center_asset_custodians_user_id",
        table_name="cost_center_asset_custodians",
    )
    op.drop_index(
        "ix_cost_center_asset_custodians_cost_center_id",
        table_name="cost_center_asset_custodians",
    )
    op.drop_table("cost_center_asset_custodians")
