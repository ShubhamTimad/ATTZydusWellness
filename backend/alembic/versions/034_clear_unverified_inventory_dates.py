"""Clear last verification date until physical inventory process runs."""

from __future__ import annotations

from alembic import op

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE asset_inventory_information
        SET last_verification_date = NULL,
            physical_count = 0,
            verification_status = NULL,
            verification_remarks = NULL
        """
    )


def downgrade() -> None:
    pass
