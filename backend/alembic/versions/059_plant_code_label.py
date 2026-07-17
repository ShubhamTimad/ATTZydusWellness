"""Clarify plant code and plant name labels."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = CASE field_key
                WHEN 'plant_code' THEN 'Plant Code'
                WHEN 'plant_id' THEN 'Plant Name'
            END
            WHERE field_key IN ('plant_code', 'plant_id')
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Plant name'
            WHERE field_key IN ('plant_code', 'plant_id')
            """
        )
    )
