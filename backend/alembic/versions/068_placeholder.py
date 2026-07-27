"""Placeholder revision (DB already stamped at 068).

Revision ID: 068
Revises: 067
Create Date: 2026-07-27
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "068"
down_revision: str | None = "067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
