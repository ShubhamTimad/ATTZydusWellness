"""Drop is_local_finance_user from asset_information."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("asset_information", "is_local_finance_user")


def downgrade() -> None:
    op.add_column(
        "asset_information",
        sa.Column("is_local_finance_user", sa.Boolean(), nullable=True),
    )
