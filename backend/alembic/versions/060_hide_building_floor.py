"""Hide building and floor from asset forms and details."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_visible = false
            WHERE field_key IN ('building', 'floor')
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_visible = true
            WHERE field_key IN ('building', 'floor')
            """
        )
    )
