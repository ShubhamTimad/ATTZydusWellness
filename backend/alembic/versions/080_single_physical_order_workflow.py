"""Use a single physical-order approval workflow (closure only).

Deactivates legacy creation/assignment workflows; executors come from order.execute.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "080"
down_revision = "079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE approval_workflows SET is_active = false "
            "WHERE entity_type = 'physical_order_creation'"
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE approval_workflow_mappings AS m
            SET is_active = false
            FROM approval_workflows AS w
            WHERE m.workflow_id = w.id
              AND (
                w.entity_type = 'physical_order_creation'
                OR lower(m.action_code) IN ('order.create', 'order:create')
              )
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE approval_workflows
            SET name = 'Physical Order Approval'
            WHERE entity_type = 'physical_order_closure'
              AND name IN (
                'Physical Order Completion Approval',
                'Physical Order Closure Approval'
              )
            """
        )
    )


def downgrade() -> None:
    # Do not reactivate — previous creation workflows may have been intentionally off.
    pass
