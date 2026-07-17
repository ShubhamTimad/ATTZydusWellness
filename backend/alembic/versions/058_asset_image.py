"""Add one optional image to each asset."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset_master", sa.Column("image_data", sa.LargeBinary(), nullable=True))
    op.add_column("asset_master", sa.Column("image_content_type", sa.String(length=32), nullable=True))
    op.add_column("asset_master", sa.Column("image_filename", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("asset_master", "image_filename")
    op.drop_column("asset_master", "image_content_type")
    op.drop_column("asset_master", "image_data")
