"""Make asset_code required and unique.

Revision ID: 105
Revises: 104
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "105"
down_revision = "104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Backfill any empty, null, or duplicate asset_code using combined_asset_number
    op.execute(
        sa.text(
            """
            UPDATE asset_master
            SET asset_code = combined_asset_number
            WHERE trim(COALESCE(asset_code, '')) = ''
               OR asset_code IN (
                   SELECT asset_code
                   FROM asset_master
                   WHERE trim(COALESCE(asset_code, '')) != ''
                   GROUP BY asset_code
                   HAVING count(*) > 1
               );
            """
        )
    )

    # 2. Ensure NOT NULL
    op.alter_column("asset_master", "asset_code", nullable=False)

    # 3. Drop existing non-unique index if present
    op.execute(sa.text("DROP INDEX IF EXISTS ix_asset_master_asset_code;"))

    # 4. Add unique constraint and unique index
    op.create_unique_constraint("uq_asset_master_asset_code", "asset_master", ["asset_code"])
    op.create_index("ix_asset_master_asset_code", "asset_master", ["asset_code"], unique=True)

    # 5. Update asset_field_config so it is marked required in dynamic UI
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if has_field_config:
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config
                SET is_required = true
                WHERE field_key = 'asset_code';
                """
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if has_field_config:
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config
                SET is_required = false
                WHERE field_key = 'asset_code';
                """
            )
        )

    op.drop_index("ix_asset_master_asset_code", table_name="asset_master")
    op.drop_constraint("uq_asset_master_asset_code", "asset_master", type_="unique")
    op.create_index("ix_asset_master_asset_code", "asset_master", ["asset_code"], unique=False)
