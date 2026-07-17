"""Store each user's asset-list column selection."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("asset_list_columns", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "asset_list_columns")
