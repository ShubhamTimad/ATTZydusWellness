"""Add department and cost center to users.

Revision ID: 069
Revises: 068
Create Date: 2026-07-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "069"
down_revision: str | None = "068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("department_id", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("cost_center_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_department_id_org_units",
        "users",
        "org_units",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_users_cost_center_id_cost_center_masters",
        "users",
        "cost_center_masters",
        ["cost_center_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_users_department_id", "users", ["department_id"], unique=False)
    op.create_index("ix_users_cost_center_id", "users", ["cost_center_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_cost_center_id", table_name="users")
    op.drop_index("ix_users_department_id", table_name="users")
    op.drop_constraint("fk_users_cost_center_id_cost_center_masters", "users", type_="foreignkey")
    op.drop_constraint("fk_users_department_id_org_units", "users", type_="foreignkey")
    op.drop_column("users", "cost_center_id")
    op.drop_column("users", "department_id")
