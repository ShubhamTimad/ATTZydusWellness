"""Hierarchical asset masters: plant→cost→profit and plant→functional→actual."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cost_center_masters", sa.Column("plant_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_cost_center_masters_plant_id",
        "cost_center_masters",
        "org_units",
        ["plant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_cost_center_masters_plant_id", "cost_center_masters", ["plant_id"])

    op.execute(
        """
        UPDATE cost_center_masters cc
        SET plant_id = (SELECT id FROM org_units WHERE type = 'PLANT' ORDER BY id LIMIT 1)
        WHERE plant_id IS NULL
        """
    )
    op.alter_column("cost_center_masters", "plant_id", nullable=False)

    op.drop_constraint("cost_center_masters_code_key", "cost_center_masters", type_="unique")
    op.create_unique_constraint(
        "uq_cost_center_masters_plant_code", "cost_center_masters", ["plant_id", "code"]
    )

    op.add_column("profit_center_masters", sa.Column("cost_center_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_profit_center_masters_cost_center_id",
        "profit_center_masters",
        "cost_center_masters",
        ["cost_center_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_profit_center_masters_cost_center_id", "profit_center_masters", ["cost_center_id"])

    op.execute(
        """
        UPDATE profit_center_masters pc
        SET cost_center_id = (SELECT id FROM cost_center_masters ORDER BY id LIMIT 1)
        WHERE cost_center_id IS NULL
        """
    )
    op.alter_column("profit_center_masters", "cost_center_id", nullable=False)

    op.drop_constraint("profit_center_masters_code_key", "profit_center_masters", type_="unique")
    op.create_unique_constraint(
        "uq_profit_center_masters_cc_code", "profit_center_masters", ["cost_center_id", "code"]
    )

    op.create_table(
        "functional_location_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plant_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["plant_id"], ["org_units.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plant_id", "code", name="uq_functional_location_masters_plant_code"),
    )
    op.create_index("ix_functional_location_masters_plant_id", "functional_location_masters", ["plant_id"])

    op.create_table(
        "actual_location_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("functional_location_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["functional_location_id"], ["functional_location_masters.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "functional_location_id", "code", name="uq_actual_location_masters_fl_code"
        ),
    )
    op.create_index(
        "ix_actual_location_masters_functional_location_id",
        "actual_location_masters",
        ["functional_location_id"],
    )

    # Migrate legacy flat location_masters into hierarchical tables
    op.execute(
        """
        INSERT INTO functional_location_masters (plant_id, code, description, is_active)
        SELECT plant_id, code, description, is_active
        FROM location_masters
        WHERE location_type IN ('functional', 'both') AND plant_id IS NOT NULL
        ON CONFLICT ON CONSTRAINT uq_functional_location_masters_plant_code DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO actual_location_masters (functional_location_id, code, description, is_active)
        SELECT fl.id, lm.code, lm.description, lm.is_active
        FROM location_masters lm
        JOIN functional_location_masters fl
          ON fl.plant_id = lm.plant_id AND fl.code = COALESCE(
            (SELECT code FROM location_masters lm2
             WHERE lm2.plant_id = lm.plant_id AND lm2.location_type = 'functional' LIMIT 1),
            'MIGRATED-FL'
          )
        WHERE lm.location_type IN ('actual', 'both') AND lm.plant_id IS NOT NULL
        ON CONFLICT ON CONSTRAINT uq_actual_location_masters_fl_code DO NOTHING
        """
    )

    op.drop_table("location_masters")


def downgrade() -> None:
    op.create_table(
        "location_masters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("plant_id", sa.Integer(), nullable=True),
        sa.Column("location_type", sa.String(length=16), server_default="both", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["plant_id"], ["org_units.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.drop_table("actual_location_masters")
    op.drop_table("functional_location_masters")

    op.drop_constraint("uq_profit_center_masters_cc_code", "profit_center_masters", type_="unique")
    op.create_unique_constraint("profit_center_masters_code_key", "profit_center_masters", ["code"])
    op.drop_constraint("fk_profit_center_masters_cost_center_id", "profit_center_masters", type_="foreignkey")
    op.drop_column("profit_center_masters", "cost_center_id")

    op.drop_constraint("uq_cost_center_masters_plant_code", "cost_center_masters", type_="unique")
    op.create_unique_constraint("cost_center_masters_code_key", "cost_center_masters", ["code"])
    op.drop_constraint("fk_cost_center_masters_plant_id", "cost_center_masters", type_="foreignkey")
    op.drop_column("cost_center_masters", "plant_id")
