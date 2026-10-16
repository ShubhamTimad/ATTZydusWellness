"""Asset field display configuration table."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from modules.assets.field_config_seed import ASSET_FIELD_CONFIG_SEED

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_field_config",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("field_key", sa.String(length=128), nullable=False),
        sa.Column("display_label", sa.String(length=255), nullable=False),
        sa.Column("is_visible", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_required", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
        sa.CheckConstraint(
            "NOT is_required OR is_visible",
            name="ck_asset_field_config_required_visible",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("field_key", name="uq_asset_field_config_field_key"),
    )
    op.create_index("ix_asset_field_config_field_key", "asset_field_config", ["field_key"])

    table = sa.table(
        "asset_field_config",
        sa.column("field_key", sa.String),
        sa.column("display_label", sa.String),
        sa.column("is_visible", sa.Boolean),
        sa.column("is_required", sa.Boolean),
    )
    op.bulk_insert(
        table,
        [
            {
                "field_key": row["field_key"],
                "display_label": row["display_label"],
                "is_visible": row["is_visible"],
                "is_required": row["is_required"],
            }
            for row in ASSET_FIELD_CONFIG_SEED
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_asset_field_config_field_key", table_name="asset_field_config")
    op.drop_table("asset_field_config")
