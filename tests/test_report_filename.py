"""Downloaded Excel/PDF reports are named {Report name}_{DD-MM-YYYY}.ext."""

from __future__ import annotations

from datetime import datetime

from modules.reports.export import report_filename


def test_report_filename_is_name_underscore_date() -> None:
    today = datetime.now().strftime("%d-%m-%Y")
    assert (
        report_filename("asset_register", "xlsx", report_name="Asset Register")
        == f"Asset Register_{today}.xlsx"
    )
    assert (
        report_filename("physical_orders_summary", "pdf", report_name="Physical Order")
        == f"Physical Order_{today}.pdf"
    )
    assert "Zydus_Takeda" not in report_filename("asset_register", "xlsx")
