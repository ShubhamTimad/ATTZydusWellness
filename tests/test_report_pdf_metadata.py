"""Report PDFs carry a Sr. No. column and a document title (Chrome tab shows it)."""

from __future__ import annotations


def test_pdf_has_title_and_serial_column() -> None:
    from modules.platform.settings.document_format import DEFAULTS, previewing
    from modules.reports.export import ReportDocument, _pdf_data_table, _pdf_styles, build_pdf

    doc = ReportDocument(
        title="Physical Order",
        subtitle="1 order",
        headers=["Order number", "Status"],
        rows=[["PVO-1", "Draft"]],
        show_signatures=False,
    )
    with previewing(DEFAULTS):
        pdf = build_pdf(doc)
    assert b"/Title (Physical Order)" in pdf
    cells = _pdf_data_table(doc, _pdf_styles(), 500)._cellvalues
    assert [cells[0][0].text, cells[1][0].text] == ["Sr. No.", "1"]
