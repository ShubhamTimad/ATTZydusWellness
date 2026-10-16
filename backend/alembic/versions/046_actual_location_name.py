"""Add name column to actual location masters.

Revision ID: 046
Revises: 045
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "046"
down_revision: str | None = "045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "actual_location_masters",
        sa.Column("name", sa.String(length=255), nullable=True),
    )
    op.execute(sa.text("UPDATE actual_location_masters SET name = description WHERE name IS NULL"))
    op.alter_column("actual_location_masters", "name", nullable=False)


def downgrade() -> None:
    op.drop_column("actual_location_masters", "name")
