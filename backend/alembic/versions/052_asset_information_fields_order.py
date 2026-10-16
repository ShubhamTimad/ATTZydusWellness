"""Add sub_no to asset_master; update asset information field labels."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset_master", sa.Column("sub_no", sa.String(length=64), nullable=True))

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
                  ('sub_no', 'Sub-No', true, false),
                  ('asset_description', 'Asset Description', true, false)
                ON CONFLICT (field_key) DO UPDATE
                SET display_label = EXCLUDED.display_label,
                    is_visible = EXCLUDED.is_visible
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset Number'
                WHERE field_key = 'asset_code'
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Combined Asset No'
                WHERE field_key = 'combined_asset_number'
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset Physical Condition'
                WHERE field_key IN ('asset_condition_id', 'asset_condition_code')
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'RFID Code'
                WHERE field_key = 'rfid_code'
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset Category'
                WHERE field_key IN ('asset_category_id', 'category_code')
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset Type'
                WHERE field_key = 'asset_type'
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset Class'
                WHERE field_key = 'asset_class'
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset Custodian'
                WHERE field_key IN ('asset_custodian_id', 'asset_custodian_code')
                """
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if has_field_config:
        op.execute(sa.text("DELETE FROM asset_field_config WHERE field_key = 'sub_no'"))
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset code'
                WHERE field_key = 'asset_code'
                """
            )
        )
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config SET display_label = 'Asset condition'
                WHERE field_key IN ('asset_condition_id', 'asset_condition_code')
                """
            )
        )
    op.drop_column("asset_master", "sub_no")
