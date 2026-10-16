"""Add user_sessions.auth_method for SSO vs password idle policy.

Revision ID: 095
Revises: 094
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "095"
down_revision: str | None = "094"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column(
            "auth_method",
            sa.String(length=16),
            nullable=False,
            server_default="password",
        ),
    )


def downgrade() -> None:
    op.drop_column("user_sessions", "auth_method")
