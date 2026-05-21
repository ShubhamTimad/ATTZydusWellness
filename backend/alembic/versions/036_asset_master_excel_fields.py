"""Asset master fields aligned with Excel import template."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset_master", sa.Column("asset_class", sa.String(length=128), nullable=True))
    op.add_column("asset_master", sa.Column("asset_type", sa.String(length=128), nullable=True))
    op.create_index("ix_asset_master_asset_class", "asset_master", ["asset_class"])

    op.add_column("asset_location_information", sa.Column("sub_location", sa.String(length=255), nullable=True))

    op.add_column("asset_financial_information", sa.Column("invoice_no", sa.String(length=128), nullable=True))
    op.add_column("asset_financial_information", sa.Column("invoice_date", sa.Date(), nullable=True))
    op.add_column("asset_financial_information", sa.Column("voucher_no", sa.String(length=128), nullable=True))
    op.add_column("asset_financial_information", sa.Column("voucher_date", sa.Date(), nullable=True))
    op.add_column("asset_financial_information", sa.Column("grn_no", sa.String(length=128), nullable=True))
    op.add_column("asset_financial_information", sa.Column("grn_date", sa.Date(), nullable=True))
    op.add_column("asset_financial_information", sa.Column("put_to_use_date", sa.Date(), nullable=True))
    op.add_column(
        "asset_financial_information",
        sa.Column("depreciation_rate", sa.Numeric(8, 4), nullable=True),
    )
    op.add_column("asset_financial_information", sa.Column("life_span", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("asset_financial_information", "life_span")
    op.drop_column("asset_financial_information", "depreciation_rate")
    op.drop_column("asset_financial_information", "put_to_use_date")
    op.drop_column("asset_financial_information", "grn_date")
    op.drop_column("asset_financial_information", "grn_no")
    op.drop_column("asset_financial_information", "voucher_date")
    op.drop_column("asset_financial_information", "voucher_no")
    op.drop_column("asset_financial_information", "invoice_date")
    op.drop_column("asset_financial_information", "invoice_no")
    op.drop_column("asset_location_information", "sub_location")
    op.drop_index("ix_asset_master_asset_class", table_name="asset_master")
    op.drop_column("asset_master", "asset_type")
    op.drop_column("asset_master", "asset_class")
