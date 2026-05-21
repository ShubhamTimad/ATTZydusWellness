"""Add required plant code to org_units.

Revision ID: 029
Revises: 12db29f4cf41
Create Date: 2026-05-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "029"
down_revision: str | None = "12db29f4cf41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("org_units", sa.Column("code", sa.String(length=64), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE org_units
               SET code = 'PLANT-' || id::text
             WHERE code IS NULL
            """
        )
    )
    op.alter_column("org_units", "code", existing_type=sa.String(length=64), nullable=False)
    op.create_unique_constraint("uq_org_units_type_code", "org_units", ["type", "code"])


def downgrade() -> None:
    op.drop_constraint("uq_org_units_type_code", "org_units", type_="unique")
    op.drop_column("org_units", "code")
