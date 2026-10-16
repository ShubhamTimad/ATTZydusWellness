"""Asset custodian and condition masters."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_custodian_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_asset_custodian_masters_code"),
    )
    op.create_index("ix_asset_custodian_masters_code", "asset_custodian_masters", ["code"])

    op.create_table(
        "asset_condition_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_asset_condition_masters_code"),
    )
    op.create_index("ix_asset_condition_masters_code", "asset_condition_masters", ["code"])

    op.add_column(
        "asset_master",
        sa.Column(
            "asset_custodian_id",
            sa.Integer(),
            sa.ForeignKey("asset_custodian_masters.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "asset_master",
        sa.Column(
            "asset_condition_id",
            sa.Integer(),
            sa.ForeignKey("asset_condition_masters.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_asset_master_asset_custodian_id", "asset_master", ["asset_custodian_id"])
    op.create_index("ix_asset_master_asset_condition_id", "asset_master", ["asset_condition_id"])


def downgrade() -> None:
    op.drop_index("ix_asset_master_asset_condition_id", table_name="asset_master")
    op.drop_index("ix_asset_master_asset_custodian_id", table_name="asset_master")
    op.drop_column("asset_master", "asset_condition_id")
    op.drop_column("asset_master", "asset_custodian_id")
    op.drop_index("ix_asset_condition_masters_code", table_name="asset_condition_masters")
    op.drop_table("asset_condition_masters")
    op.drop_index("ix_asset_custodian_masters_code", table_name="asset_custodian_masters")
    op.drop_table("asset_custodian_masters")
