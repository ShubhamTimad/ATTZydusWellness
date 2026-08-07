"""Add is_scrapyard on functional locations (disposal receive locations)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "089"
down_revision = "088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "functional_location_masters",
        sa.Column(
            "is_scrapyard",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("functional_location_masters", "is_scrapyard")
