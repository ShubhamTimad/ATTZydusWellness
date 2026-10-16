"""Mark first Physical order workflow step as assign when multi-step."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "081"
down_revision = "080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Multi-step physical-order workflows: first step = executor assignment pool.
    conn.execute(
        sa.text(
            """
            UPDATE approval_steps AS s
            SET step_kind = 'assign'
            FROM approval_workflows AS w
            WHERE s.workflow_id = w.id
              AND w.entity_type = 'physical_order_closure'
              AND s.step_order = (
                SELECT MIN(s2.step_order)
                FROM approval_steps AS s2
                WHERE s2.workflow_id = w.id
              )
              AND (
                SELECT COUNT(*) FROM approval_steps AS s3 WHERE s3.workflow_id = w.id
              ) > 1
              AND COALESCE(s.step_kind, 'approve') = 'approve'
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE approval_steps AS s
            SET step_kind = 'approve'
            FROM approval_workflows AS w
            WHERE s.workflow_id = w.id
              AND w.entity_type = 'physical_order_closure'
              AND s.step_kind = 'assign'
            """
        )
    )
