"""Allow multiple terminal approval_requests per entity (reject → resume → reject).

Replaces uq_approval_requests_entity_status (entity_type, entity_id, status) which
blocked a second reject after resume created a fresh pending request.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "085"
down_revision = "084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_approval_requests_entity_status",
        "approval_requests",
        type_="unique",
    )
    op.create_index(
        "uq_approval_requests_entity_active",
        "approval_requests",
        ["entity_type", "entity_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'in_rework')"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_approval_requests_entity_active",
        table_name="approval_requests",
    )
    op.create_unique_constraint(
        "uq_approval_requests_entity_status",
        "approval_requests",
        ["entity_type", "entity_id", "status"],
    )
