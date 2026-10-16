"""Make Actual Location 1 / 2 optional on asset create."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if not has_field_config:
        return

    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_required = false
            WHERE field_key IN ('functional_location', 'actual_location')
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if not has_field_config:
        return

    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_required = true
            WHERE field_key IN ('functional_location', 'actual_location')
              AND is_visible = true
            """
        )
    )
