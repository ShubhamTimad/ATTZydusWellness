"""User many departments and cost centers; allow multiple plants.

Revision ID: 070
Revises: 069
Create Date: 2026-07-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "070"
down_revision: str | None = "069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_departments",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "org_unit_id",
            sa.Integer(),
            sa.ForeignKey("org_units.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_user_departments_org_unit_id", "user_departments", ["org_unit_id"])

    op.create_table(
        "user_cost_centers",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "cost_center_id",
            sa.Integer(),
            sa.ForeignKey("cost_center_masters.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_user_cost_centers_cost_center_id", "user_cost_centers", ["cost_center_id"])

    # Migrate scalar FKs into association tables.
    op.execute(
        """
        INSERT INTO user_departments (user_id, org_unit_id)
        SELECT id, department_id FROM users
        WHERE department_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO user_cost_centers (user_id, cost_center_id)
        SELECT id, cost_center_id FROM users
        WHERE cost_center_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )

    op.drop_index("ix_users_cost_center_id", table_name="users")
    op.drop_index("ix_users_department_id", table_name="users")
    op.drop_constraint("fk_users_cost_center_id_cost_center_masters", "users", type_="foreignkey")
    op.drop_constraint("fk_users_department_id_org_units", "users", type_="foreignkey")
    op.drop_column("users", "cost_center_id")
    op.drop_column("users", "department_id")

    # Allow multiple plants per user.
    op.drop_constraint("uq_user_org_units_user_id", "user_org_units", type_="unique")
    op.create_unique_constraint(
        "uq_user_org_units_user_org_unit",
        "user_org_units",
        ["user_id", "org_unit_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_user_org_units_user_org_unit", "user_org_units", type_="unique")
    op.create_unique_constraint("uq_user_org_units_user_id", "user_org_units", ["user_id"])

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

    op.execute(
        """
        UPDATE users u
        SET department_id = d.org_unit_id
        FROM (
          SELECT DISTINCT ON (user_id) user_id, org_unit_id
          FROM user_departments
          ORDER BY user_id, org_unit_id
        ) d
        WHERE u.id = d.user_id
        """
    )
    op.execute(
        """
        UPDATE users u
        SET cost_center_id = c.cost_center_id
        FROM (
          SELECT DISTINCT ON (user_id) user_id, cost_center_id
          FROM user_cost_centers
          ORDER BY user_id, cost_center_id
        ) c
        WHERE u.id = c.user_id
        """
    )

    op.drop_index("ix_user_cost_centers_cost_center_id", table_name="user_cost_centers")
    op.drop_table("user_cost_centers")
    op.drop_index("ix_user_departments_org_unit_id", table_name="user_departments")
    op.drop_table("user_departments")
