"""Add CapEx form number to asset field config (import/export labels)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "064"
down_revision = "063"
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
            INSERT INTO asset_field_config (field_key, display_label, is_visible, is_required)
            VALUES ('capitalization_form_number', 'CapEx form number', true, false)
            ON CONFLICT (field_key) DO UPDATE
            SET display_label = EXCLUDED.display_label
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
            "DELETE FROM asset_field_config WHERE field_key = 'capitalization_form_number'"
        )
    )
