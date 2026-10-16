"""Financial section: show Cost Center / name / Party / Cap date / APC-IGAAP / Life-Span only.

Hide other financial fields (including profit_center) and drop profit_center required.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if not has_field_config:
        return

    op.execute(
        sa.text(
            """
            INSERT INTO asset_field_config (field_key, display_label, is_visible, is_required)
            VALUES
              ('cost_center', 'Cost Center', true, true),
              ('cost_center_name', 'Cost Center Name', true, false),
              ('party_details', 'Party Details', true, false),
              ('cap_date', 'Capitalization Date', true, false),
              ('gross_block', 'APC-IGAAP', true, false),
              ('life_span', 'Life-Span (Years)', true, false)
            ON CONFLICT (field_key) DO UPDATE
            SET display_label = EXCLUDED.display_label,
                is_visible = true,
                is_required = EXCLUDED.is_required
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_visible = false, is_required = false
            WHERE field_key IN (
              'profit_center',
              'laboratory',
              'invoice_no',
              'invoice_date',
              'voucher_no',
              'voucher_date',
              'grn_no',
              'grn_date',
              'put_to_use_date',
              'depreciation_rate',
              'vendor_name',
              'po_number',
              'currency'
            )
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if not has_field_config:
        return

    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Cost center', is_visible = true, is_required = true
            WHERE field_key = 'cost_center'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_visible = false, is_required = false
            WHERE field_key = 'cost_center_name'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET display_label = 'Profit center', is_visible = true, is_required = true
            WHERE field_key = 'profit_center'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config SET display_label = 'Party details', is_visible = true
            WHERE field_key = 'party_details'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config SET display_label = 'Capitalization date', is_visible = true
            WHERE field_key = 'cap_date'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config SET display_label = 'Gross block', is_visible = true
            WHERE field_key = 'gross_block'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config SET display_label = 'Life span', is_visible = true
            WHERE field_key = 'life_span'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE asset_field_config
            SET is_visible = true, is_required = false
            WHERE field_key IN (
              'laboratory',
              'invoice_no',
              'invoice_date',
              'voucher_no',
              'voucher_date',
              'grn_no',
              'grn_date',
              'put_to_use_date',
              'depreciation_rate',
              'vendor_name',
              'po_number',
              'currency'
            )
            """
        )
    )
