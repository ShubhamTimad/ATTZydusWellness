"""Add name column to functional location masters.

Revision ID: 045
Revises: 044
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "045"
down_revision: str | None = "044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "functional_location_masters",
        sa.Column("name", sa.String(length=255), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE functional_location_masters SET name = description WHERE name IS NULL"
        )
    )
    op.alter_column("functional_location_masters", "name", nullable=False)


def downgrade() -> None:
    op.drop_column("functional_location_masters", "name")
