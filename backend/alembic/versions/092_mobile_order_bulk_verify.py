"""Add mobile.order.bulk_verify for order bulk RFID verification.

Revision ID: 092
Revises: 091
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "092"
down_revision: str | None = "091"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CODE = "mobile.order.bulk_verify"
_FEATURE_KEY = "mobile_order"


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, :action, :code, :description, CURRENT_TIMESTAMP
            FROM features f
            WHERE f.key = :fkey
              AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)
            """
        ).bindparams(
            fkey=_FEATURE_KEY,
            action="bulk_verify",
            code=_CODE,
            description="Bulk-verify order assets from a single RFID scan on mobile",
        )
    )

    # Roles that already could scan on mobile keep bulk verification until
    # admins choose to split the two permissions.
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT rp.role_id, p_new.id
            FROM permissions p_old
            JOIN role_permissions rp ON rp.permission_id = p_old.id
            JOIN permissions p_new ON p_new.code = :new_code
            WHERE p_old.code = 'mobile.order.scan'
              AND NOT EXISTS (
                SELECT 1
                FROM role_permissions existing
                WHERE existing.role_id = rp.role_id
                  AND existing.permission_id = p_new.id
              )
            """
        ).bindparams(new_code=_CODE)
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id IN (
                SELECT id FROM permissions WHERE code = :code
            )
            """
        ).bindparams(code=_CODE)
    )
    op.execute(
        sa.text("DELETE FROM permissions WHERE code = :code").bindparams(code=_CODE)
    )
