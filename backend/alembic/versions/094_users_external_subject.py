"""Add users.external_subject for OIDC SSO identity linking.

Revision ID: 094
Revises: 093
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "094"
down_revision: str | None = "093"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("external_subject", sa.String(length=255), nullable=True),
    )
    op.create_index("ix_users_external_subject", "users", ["external_subject"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_external_subject", table_name="users")
    op.drop_column("users", "external_subject")
