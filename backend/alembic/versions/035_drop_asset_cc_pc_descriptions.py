"""Descriptions live on cost/profit center masters only."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("asset_financial_information", "profit_center_description")
    op.drop_column("asset_financial_information", "cost_center_description")


def downgrade() -> None:
    op.add_column(
        "asset_financial_information",
        sa.Column("cost_center_description", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "asset_financial_information",
        sa.Column("profit_center_description", sa.String(length=512), nullable=True),
    )
