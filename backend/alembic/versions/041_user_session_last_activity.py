"""user_sessions.last_activity_at for idle timeout

Revision ID: 041
Revises: 040
Create Date: 2026-06-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "041"
down_revision: str | None = "040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text("UPDATE user_sessions SET last_activity_at = created_at WHERE last_activity_at IS NULL")
    )


def downgrade() -> None:
    op.drop_column("user_sessions", "last_activity_at")
