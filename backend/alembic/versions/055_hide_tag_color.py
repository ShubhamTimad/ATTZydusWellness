"""Hide tag color fields in asset field config."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "055"
down_revision = "054"
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
            WHERE field_key IN ('tag_color_id', 'tag_color_code')
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
            WHERE field_key IN ('tag_color_id', 'tag_color_code')
            """
        )
    )
