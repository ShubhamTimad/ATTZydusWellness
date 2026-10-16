"""Asset class masters + FK on asset_master."""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def _code_from_name(name: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip().upper()).strip("_")
    return (raw or "CLASS")[:64]


def upgrade() -> None:
    op.create_table(
        "asset_class_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_asset_class_masters_code"),
    )
    op.create_index("ix_asset_class_masters_code", "asset_class_masters", ["code"])

    op.add_column(
        "asset_master",
        sa.Column(
            "asset_class_id",
            sa.Integer(),
            sa.ForeignKey("asset_class_masters.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_asset_master_asset_class_id", "asset_master", ["asset_class_id"])

    # Backfill masters from distinct legacy free-text values.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT DISTINCT asset_class FROM asset_master "
            "WHERE asset_class IS NOT NULL AND TRIM(asset_class) <> ''"
        )
    ).fetchall()
    used_codes: set[str] = set()
    name_to_id: dict[str, int] = {}
    for (name,) in rows:
        label = str(name).strip()
        if not label:
            continue
        code = _code_from_name(label)
        base = code
        n = 2
        while code in used_codes:
            suffix = f"_{n}"
            code = f"{base[: 64 - len(suffix)]}{suffix}"
            n += 1
        used_codes.add(code)
        result = bind.execute(
            sa.text(
                "INSERT INTO asset_class_masters (code, name, is_active) "
                "VALUES (:code, :name, true) RETURNING id"
            ),
            {"code": code, "name": label[:255]},
        )
        # SQLite may not support RETURNING on older versions — fall back.
        row = result.fetchone()
        if row is None:
            row = bind.execute(
                sa.text("SELECT id FROM asset_class_masters WHERE code = :code"),
                {"code": code},
            ).fetchone()
        if row is not None:
            name_to_id[label.lower()] = int(row[0])

    for name_key, class_id in name_to_id.items():
        bind.execute(
            sa.text(
                "UPDATE asset_master SET asset_class_id = :cid "
                "WHERE asset_class IS NOT NULL AND LOWER(TRIM(asset_class)) = :name"
            ),
            {"cid": class_id, "name": name_key},
        )


def downgrade() -> None:
    op.drop_index("ix_asset_master_asset_class_id", table_name="asset_master")
    op.drop_column("asset_master", "asset_class_id")
    op.drop_index("ix_asset_class_masters_code", table_name="asset_class_masters")
    op.drop_table("asset_class_masters")
