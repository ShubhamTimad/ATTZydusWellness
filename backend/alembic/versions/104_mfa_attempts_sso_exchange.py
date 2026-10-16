"""MFA challenge attempt counter and one-time SSO exchange codes."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "104"
down_revision = "103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mfa_challenges",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "sso_exchange_codes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=False),
        sa.Column("portal", sa.String(length=16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("code_hash", name="uq_sso_exchange_codes_code_hash"),
    )


def downgrade() -> None:
    op.drop_table("sso_exchange_codes")
    op.drop_column("mfa_challenges", "attempts")
