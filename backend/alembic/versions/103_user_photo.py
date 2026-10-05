"""Add one optional profile photo to each user."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "103"
down_revision = "102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("photo_data", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("photo_content_type", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "photo_content_type")
    op.drop_column("users", "photo_data")
