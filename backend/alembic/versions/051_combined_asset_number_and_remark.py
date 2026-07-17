"""Add combined_asset_number (unique) and remark; drop asset_code uniqueness."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_master",
        sa.Column("combined_asset_number", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "asset_master",
        sa.Column("remark", sa.Text(), nullable=True),
    )

    # Backfill from existing unique asset_code so the new unique constraint can apply.
    op.execute(
        sa.text(
            """
            UPDATE asset_master
            SET combined_asset_number = asset_code
            WHERE combined_asset_number IS NULL
            """
        )
    )

    op.alter_column("asset_master", "combined_asset_number", nullable=False)

    # Drop uniqueness on asset_code (keep non-unique index for search).
    op.drop_constraint("asset_master_asset_code_key", "asset_master", type_="unique")
    op.create_index("ix_asset_master_asset_code", "asset_master", ["asset_code"], unique=False)

    op.create_unique_constraint(
        "uq_asset_master_combined_asset_number",
        "asset_master",
        ["combined_asset_number"],
    )
    op.create_index(
        "ix_asset_master_combined_asset_number",
        "asset_master",
        ["combined_asset_number"],
        unique=False,
    )

    # Seed field config when the display-config table exists (migration 050).
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if has_field_config:
        op.execute(
            sa.text(
                """
                INSERT INTO asset_field_config (field_key, display_label, is_visible, is_required)
                VALUES
                  ('combined_asset_number', 'Combined Asset No', true, true),
                  ('remark', 'Remark', true, false)
                ON CONFLICT (field_key) DO UPDATE
                SET display_label = EXCLUDED.display_label,
                    is_visible = EXCLUDED.is_visible,
                    is_required = EXCLUDED.is_required
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config
                SET is_required = false
                WHERE field_key = 'asset_code'
                """
            )
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM asset_field_config WHERE field_key IN ('combined_asset_number', 'remark')"))
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_required = true
            WHERE field_key = 'asset_code'
            """
        )
    )

    op.drop_index("ix_asset_master_combined_asset_number", table_name="asset_master")
    op.drop_constraint("uq_asset_master_combined_asset_number", "asset_master", type_="unique")

    # Restore asset_code uniqueness (fails if duplicates exist).
    op.drop_index("ix_asset_master_asset_code", table_name="asset_master")
    op.create_unique_constraint("asset_master_asset_code_key", "asset_master", ["asset_code"])

    op.drop_column("asset_master", "remark")
    op.drop_column("asset_master", "combined_asset_number")
