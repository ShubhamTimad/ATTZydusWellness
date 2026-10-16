"""Add name columns to cost center and profit center masters.

Revision ID: 047
Revises: 046
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "047"
down_revision: str | None = "046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cost_center_masters",
        sa.Column("name", sa.String(length=255), nullable=True),
    )
    op.execute(sa.text("UPDATE cost_center_masters SET name = description WHERE name IS NULL"))
    op.alter_column("cost_center_masters", "name", nullable=False)

    op.add_column(
        "profit_center_masters",
        sa.Column("name", sa.String(length=255), nullable=True),
    )
    op.execute(sa.text("UPDATE profit_center_masters SET name = description WHERE name IS NULL"))
    op.alter_column("profit_center_masters", "name", nullable=False)


def downgrade() -> None:
    op.drop_column("profit_center_masters", "name")
    op.drop_column("cost_center_masters", "name")
