"""Rename cost_center field label to Cost Center Code."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "063"
down_revision = "062"
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
            SET display_label = 'Cost Center Code'
            WHERE field_key = 'cost_center'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Cost Center Name'
            WHERE field_key = 'cost_center_name'
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
            SET display_label = 'Cost Center'
            WHERE field_key = 'cost_center'
            """
        )
    )
