"""Use active users as asset custodians."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "asset_master_asset_custodian_id_fkey",
        "asset_master",
        type_="foreignkey",
    )
    # Preserve assignments only when the old master can be matched safely.
    op.execute(
        sa.text(
            """
            WITH matches AS (
              SELECT c.id AS old_id, min(u.id) AS new_id
              FROM asset_custodian_masters c
              JOIN users u
                ON lower(u.username) = lower(c.code)
                OR lower(u.full_name) = lower(c.name)
              GROUP BY c.id
              HAVING count(DISTINCT u.id) = 1
            )
            UPDATE asset_master AS a
            SET asset_custodian_id = matches.new_id
            FROM matches
            WHERE a.asset_custodian_id = matches.old_id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_master AS a
            SET asset_custodian_id = NULL
            WHERE asset_custodian_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM users u WHERE u.id = a.asset_custodian_id
              )
            """
        )
    )
    op.create_foreign_key(
        "asset_master_asset_custodian_id_fkey",
        "asset_master",
        "users",
        ["asset_custodian_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "asset_master_asset_custodian_id_fkey",
        "asset_master",
        type_="foreignkey",
    )
    op.execute(
        sa.text(
            """
            WITH matches AS (
              SELECT u.id AS old_id, min(c.id) AS new_id
              FROM users u
              JOIN asset_custodian_masters c
                ON lower(c.code) = lower(u.username)
                OR lower(c.name) = lower(u.full_name)
              GROUP BY u.id
              HAVING count(DISTINCT c.id) = 1
            )
            UPDATE asset_master AS a
            SET asset_custodian_id = matches.new_id
            FROM matches
            WHERE a.asset_custodian_id = matches.old_id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_master AS a
            SET asset_custodian_id = NULL
            WHERE asset_custodian_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM asset_custodian_masters c
                WHERE c.id = a.asset_custodian_id
              )
            """
        )
    )
    op.create_foreign_key(
        "asset_master_asset_custodian_id_fkey",
        "asset_master",
        "asset_custodian_masters",
        ["asset_custodian_id"],
        ["id"],
        ondelete="SET NULL",
    )
