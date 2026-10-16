"""Financial detail fields and inventory count defaults."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset_financial_information", sa.Column("laboratory", sa.String(length=255), nullable=True))
    op.add_column(
        "asset_financial_information",
        sa.Column("cost_center_description", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "asset_financial_information",
        sa.Column("profit_center_description", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "asset_financial_information",
        sa.Column("party_details", sa.String(length=512), nullable=True),
    )
    op.execute(
        """
        UPDATE asset_financial_information
        SET party_details = vendor_name
        WHERE party_details IS NULL AND vendor_name IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE asset_inventory_information
        SET inventory_count = 1
        WHERE inventory_count IS NULL
        """
    )
    op.execute(
        """
        UPDATE asset_inventory_information
        SET physical_count = 0
        WHERE physical_count IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("asset_financial_information", "party_details")
    op.drop_column("asset_financial_information", "profit_center_description")
    op.drop_column("asset_financial_information", "cost_center_description")
    op.drop_column("asset_financial_information", "laboratory")
