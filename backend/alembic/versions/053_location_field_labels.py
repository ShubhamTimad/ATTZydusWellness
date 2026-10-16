"""Hide sub_location; rename functional/actual location labels."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "053"
down_revision = "052"
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
            SET is_visible = false, is_required = false
            WHERE field_key = 'sub_location'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Actual Location 1'
            WHERE field_key = 'functional_location'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Actual location 2'
            WHERE field_key = 'actual_location'
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
            SET is_visible = true
            WHERE field_key = 'sub_location'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Functional location'
            WHERE field_key = 'functional_location'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Actual location'
            WHERE field_key = 'actual_location'
            """
        )
    )
