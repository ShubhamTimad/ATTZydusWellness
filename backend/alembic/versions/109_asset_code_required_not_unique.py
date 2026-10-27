"""Make asset_code required but NOT unique.

Revision ID: 109
Revises: 108
Create Date: 2026-10-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop unique constraint on asset_code if present
    op.execute(sa.text("ALTER TABLE asset_master DROP CONSTRAINT IF EXISTS uq_asset_master_asset_code;"))

    # 2. Re-create non-unique index on asset_code
    op.execute(sa.text("DROP INDEX IF EXISTS ix_asset_master_asset_code;"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_asset_master_asset_code ON asset_master (asset_code);"))

    # 3. Ensure NOT NULL remains intact
    op.alter_column("asset_master", "asset_code", nullable=False)

    # 4. Ensure asset_field_config has asset_code marked required
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
    op.execute(sa.text("DROP INDEX IF EXISTS ix_asset_master_asset_code;"))
    op.create_unique_constraint("uq_asset_master_asset_code", "asset_master", ["asset_code"])
    op.create_index("ix_asset_master_asset_code", "asset_master", ["asset_code"], unique=True)
