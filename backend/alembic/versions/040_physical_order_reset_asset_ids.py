"""Store pending FY verification resets on physical orders until creation approval."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "physical_orders",
        sa.Column("reset_verification_asset_ids", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("physical_orders", "reset_verification_asset_ids")
