"""Tag color masters and asset tag_color_id (RFID-gated)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tag_color_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color_hex", sa.String(length=16), nullable=True),
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
        sa.UniqueConstraint("code", name="uq_tag_color_masters_code"),
    )
    op.create_index("ix_tag_color_masters_code", "tag_color_masters", ["code"], unique=False)

    op.add_column(
        "asset_master",
        sa.Column(
            "tag_color_id",
            sa.Integer(),
            sa.ForeignKey("tag_color_masters.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_asset_master_tag_color_id", "asset_master", ["tag_color_id"], unique=False)

    op.execute(
        """
        INSERT INTO tag_color_masters (code, name, color_hex, is_active) VALUES
        ('RED', 'Red', '#E1242A', true),
        ('BLUE', 'Blue', '#2563EB', true),
        ('GREEN', 'Green', '#16A34A', true),
        ('YELLOW', 'Yellow', '#EAB308', true),
        ('ORANGE', 'Orange', '#EA580C', true),
        ('PURPLE', 'Purple', '#9333EA', true),
        ('BLACK', 'Black', '#171717', true),
        ('WHITE', 'White', '#F5F5F5', true)
        ON CONFLICT (code) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_asset_master_tag_color_id", table_name="asset_master")
    op.drop_column("asset_master", "tag_color_id")
    op.drop_index("ix_tag_color_masters_code", table_name="tag_color_masters")
    op.drop_table("tag_color_masters")
