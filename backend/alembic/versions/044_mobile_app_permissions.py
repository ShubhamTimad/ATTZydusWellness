"""Seed mobile application RBAC feature + permissions.

Revision ID: 044
Revises: 043
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "044"
down_revision: str | None = "043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MOBILE_FEATURES: tuple[tuple[str, str], ...] = (
    ("mobile", "Mobile app"),
    ("mobile_asset", "Assets (mobile)"),
    ("mobile_order", "Orders (mobile)"),
)

_MOBILE_PERMISSIONS: tuple[tuple[str, str, str, str], ...] = (
    ("mobile", "access", "mobile.access", "Sign in to the mobile application (APK)"),
    ("mobile_asset", "view", "mobile.asset.view", "View assets in the mobile application"),
    ("mobile_asset", "scan", "mobile.asset.scan", "Scan RFID / barcodes for assets on mobile"),
    ("mobile_order", "view", "mobile.order.view", "View physical orders in the mobile application"),
    ("mobile_order", "execute", "mobile.order.execute", "Execute physical orders from mobile"),
    ("mobile_order", "scan", "mobile.order.scan", "Scan assets during order execution on mobile"),
)


def upgrade() -> None:
    for fkey, fname in _MOBILE_FEATURES:
        op.execute(
            sa.text("""
                INSERT INTO features (key, name, description, created_at)
                SELECT :fkey, :fname, NULL, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = :fkey)
            """).bindparams(fkey=fkey, fname=fname)
        )

    for fkey, action, code, description in _MOBILE_PERMISSIONS:
        op.execute(
            sa.text("""
                INSERT INTO permissions (feature_id, action, code, description, created_at)
                SELECT f.id, :action, :code, :description, CURRENT_TIMESTAMP
                FROM features f
                WHERE f.key = :fkey
                  AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)
            """).bindparams(fkey=fkey, action=action, code=code, description=description)
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM permissions WHERE code LIKE 'mobile.%'"))
    op.execute(
        sa.text(
            "DELETE FROM features WHERE key IN ('mobile', 'mobile_asset', 'mobile_order')"
        )
    )
