"""Import: Plant Name column label; Actual Location fields stay create-required only."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "065"
down_revision = "064"
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
            SET display_label = 'Plant Name', is_visible = true
            WHERE field_key = 'plant_name'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Plant Code'
            WHERE field_key = 'plant_code'
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
            SET display_label = 'Plant description'
            WHERE field_key = 'plant_name'
            """
        )
    )
