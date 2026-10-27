"""Track asset QR/barcode print count, last printed date, and print history.

Revision ID: 106
Revises: 105
Create Date: 2026-10-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "106"
down_revision = "105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add print tracking columns to asset_master
    op.add_column(
        "asset_master",
        sa.Column("print_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "asset_master",
        sa.Column("last_printed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "asset_master",
        sa.Column(
            "last_printed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "asset_master",
        sa.Column("last_reprint_reason", sa.String(255), nullable=True),
    )
    op.create_index("ix_asset_master_print_count", "asset_master", ["print_count"])

    # 2. Create asset_print_logs table
    op.create_table(
        "asset_print_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "asset_id",
            sa.Integer(),
            sa.ForeignKey("asset_master.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "printed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "printed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("print_type", sa.String(32), nullable=False, server_default="initial"),
        sa.Column("reprint_reason", sa.String(255), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("asset_print_logs")
    op.drop_index("ix_asset_master_print_count", table_name="asset_master")
    op.drop_column("asset_master", "last_reprint_reason")
    op.drop_column("asset_master", "last_printed_by")
    op.drop_column("asset_master", "last_printed_at")
    op.drop_column("asset_master", "print_count")
