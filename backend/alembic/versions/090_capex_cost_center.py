"""Add cost_center_id on capitalization forms (scopes the approver pool)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "capitalization_forms",
        sa.Column("cost_center_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_capitalization_forms_cost_center_id",
        "capitalization_forms",
        "cost_center_masters",
        ["cost_center_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_capitalization_forms_cost_center_id",
        "capitalization_forms",
        ["cost_center_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_capitalization_forms_cost_center_id",
        table_name="capitalization_forms",
    )
    op.drop_constraint(
        "fk_capitalization_forms_cost_center_id",
        "capitalization_forms",
        type_="foreignkey",
    )
    op.drop_column("capitalization_forms", "cost_center_id")
