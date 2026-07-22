"""Create capitalization_forms table.

Revision ID: 061
Revises: 060
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capitalization_forms",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("form_number", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="draft", nullable=False),
        sa.Column("asset_name", sa.String(length=512), nullable=False),
        sa.Column("equipment_tag_no", sa.String(length=128), nullable=True),
        sa.Column("asset_specifications", sa.Text(), nullable=True),
        sa.Column("party_name", sa.String(length=255), nullable=True),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("installation_location", sa.String(length=255), nullable=True),
        sa.Column("department_head", sa.String(length=255), nullable=True),
        sa.Column("functioning_comment", sa.Text(), nullable=True),
        sa.Column("installation_date", sa.Date(), nullable=True),
        sa.Column("auc_code", sa.String(length=128), nullable=True),
        sa.Column("useful_life", sa.String(length=64), nullable=True),
        sa.Column("requires_engineering", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("approval_request_id", sa.Integer(), nullable=True),
        sa.Column("asset_id", sa.Integer(), nullable=True),
        sa.Column("rejection_comment", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["approval_request_id"], ["approval_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["asset_id"], ["asset_master.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("form_number"),
    )
    op.create_index("ix_capitalization_forms_form_number", "capitalization_forms", ["form_number"])
    op.create_index("ix_capitalization_forms_status", "capitalization_forms", ["status"])
    op.create_index("ix_capitalization_forms_asset_id", "capitalization_forms", ["asset_id"])


def downgrade() -> None:
    op.drop_index("ix_capitalization_forms_asset_id", table_name="capitalization_forms")
    op.drop_index("ix_capitalization_forms_status", table_name="capitalization_forms")
    op.drop_index("ix_capitalization_forms_form_number", table_name="capitalization_forms")
    op.drop_table("capitalization_forms")
