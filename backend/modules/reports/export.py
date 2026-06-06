from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


@dataclass(frozen=True)
class ReportDocument:
    title: str
    subtitle: str
    headers: list[str]
    rows: list[list[str]]


def _safe_cell(value: str | None) -> str:
    if value is None:
        return ""
    return str(value)


def build_xlsx(document: ReportDocument) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"

    ws.append([document.title])
    ws.append([document.subtitle])
    ws.append([])
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"].font = Font(size=10)

    ws.append(document.headers)
    header_row = ws.max_row
    for cell in ws[header_row]:
        cell.font = Font(bold=True)

    for row in document.rows:
        ws.append([_safe_cell(v) for v in row])

    for col_idx, header in enumerate(document.headers, start=1):
        max_len = len(header)
        for row in document.rows:
            if col_idx - 1 < len(row):
                max_len = max(max_len, len(_safe_cell(row[col_idx - 1])))
        ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 2, 48)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_pdf(document: ReportDocument) -> bytes:
    buf = io.BytesIO()
    page_size = landscape(A4) if len(document.headers) > 6 else A4
    pdf = SimpleDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=28,
        rightMargin=28,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph(document.title, styles["Title"]),
        Spacer(1, 6),
        Paragraph(document.subtitle, styles["Normal"]),
        Spacer(1, 14),
    ]

    if not document.rows:
        story.append(Paragraph("No records found for the selected filters.", styles["Normal"]))
    else:
        table_data = [document.headers] + [[_safe_cell(c) for c in row] for row in document.rows]
        col_count = len(document.headers)
        available_width = page_size[0] - pdf.leftMargin - pdf.rightMargin
        col_width = available_width / max(col_count, 1)
        table = Table(table_data, colWidths=[col_width] * col_count, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E1242A")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(table)

    pdf.build(story)
    return buf.getvalue()


def report_filename(report_key: str, fmt: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    ext = "xlsx" if fmt == "xlsx" else "pdf"
    return f"{report_key}_{stamp}.{ext}"


def content_type_for_format(fmt: str) -> str:
    if fmt == "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return "application/pdf"
