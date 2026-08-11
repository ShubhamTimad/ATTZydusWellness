from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from modules.reports.pdf_chrome import (
    BRAND_RED,
    ChromeCanvas,
    FOOTER_BAND,
    HEADER_BAND,
    PAGE_MARGIN,
    format_generated_at,
)

ROW_ALT = colors.HexColor("#F8FAFC")

PDF_MARGIN = PAGE_MARGIN
PDF_BODY_FONT = 7
PDF_HEADER_FONT = 7.5
MIN_COL_WIDTH = 28
MAX_COL_WIDTH = 110

_COMPACT_HEADERS = frozenset({"plant", "status", "scans in period", "scans", "fy status"})
_MEDIUM_HEADERS = frozenset({"asset code", "rfid code", "rfid", "last verification", "scan time", "created at", "completed at"})
_FLEXIBLE_HEADERS = frozenset({"asset name", "order number", "rejection reason", "description", "functional location", "actual location"})


def _header_key(header: str) -> str:
    return header.strip().lower()


def _column_bounds(header: str, available_width: float) -> tuple[float, float]:
    key = _header_key(header)
    if key in _FLEXIBLE_HEADERS:
        return 72, available_width * 0.45
    if key in _COMPACT_HEADERS:
        return 28, 58
    if key in _MEDIUM_HEADERS or "verification" in key or "date" in key:
        return 44, 82
    return MIN_COL_WIDTH, MAX_COL_WIDTH


@dataclass(frozen=True)
class ReportDocument:
    title: str
    subtitle: str
    headers: list[str]
    rows: list[list[str]]
    summary: tuple[tuple[str, str], ...] = ()


def _safe_cell(value: str | None) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _clean_pdf_text(value: str) -> str:
    text = _safe_cell(value)
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text)
    return escape(text)


def _pdf_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "header": ParagraphStyle(
            "ReportHeaderCell",
            fontName="Helvetica-Bold",
            fontSize=PDF_HEADER_FONT,
            leading=9,
            textColor=colors.white,
            alignment=TA_LEFT,
        ),
        "cell": ParagraphStyle(
            "ReportBodyCell",
            fontName="Helvetica",
            fontSize=PDF_BODY_FONT,
            leading=9,
            textColor=colors.HexColor("#111827"),
            alignment=TA_LEFT,
            wordWrap="LTR",
        ),
        "summary_label": ParagraphStyle(
            "ReportSummaryLabel",
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor("#374151"),
            alignment=TA_LEFT,
        ),
        "summary_value": ParagraphStyle(
            "ReportSummaryValue",
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor("#111827"),
            alignment=TA_LEFT,
        ),
        "empty": ParagraphStyle(
            "ReportEmpty",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#6B7280"),
        ),
    }


def _column_weights(headers: list[str], rows: list[list[str]]) -> list[float]:
    weights: list[float] = []
    for idx, header in enumerate(headers):
        key = _header_key(header)
        content_cap = 80 if key == "asset name" else 48
        max_len = len(header)
        for row in rows:
            if idx < len(row):
                cell = _safe_cell(row[idx])
                max_len = max(max_len, min(len(cell), content_cap))
        if key in _FLEXIBLE_HEADERS:
            max_len = max(max_len, 24)
        if key in _COMPACT_HEADERS:
            max_len = min(max_len, 10)
        if key in {"last verification", "scan time", "created at", "completed at"}:
            max_len = max(max_len, 14)
        weights.append(float(max(max_len, 6)))
    return weights


def _column_widths(headers: list[str], rows: list[list[str]], available_width: float) -> list[float]:
    weights = _column_weights(headers, rows)
    bounds = [_column_bounds(header, available_width) for header in headers]
    mins = [lo for lo, _ in bounds]
    maxs = [hi for _, hi in bounds]
    total_weight = sum(weights) or 1.0

    widths = [mins[i] + (available_width - sum(mins)) * (weights[i] / total_weight) for i in range(len(headers))]

    for _ in range(12):
        for i in range(len(widths)):
            widths[i] = max(mins[i], min(maxs[i], widths[i]))
        delta = available_width - sum(widths)
        if abs(delta) < 0.5:
            break
        growable = [
            (i, weights[i])
            for i in range(len(widths))
            if delta > 0 and widths[i] < maxs[i] - 0.5
        ]
        if not growable:
            if delta < 0:
                scale = available_width / sum(widths)
                widths = [w * scale for w in widths]
            break
        grow_weight = sum(w for _, w in growable)
        for i, weight in growable:
            share = delta * (weight / grow_weight)
            widths[i] = min(maxs[i], widths[i] + share)

    remainder = available_width - sum(widths)
    if abs(remainder) > 0.5:
        flex_indices = [i for i, header in enumerate(headers) if _header_key(header) in _FLEXIBLE_HEADERS]
        if flex_indices:
            flex_weight = sum(weights[i] for i in flex_indices) or 1.0
            for i in flex_indices:
                widths[i] += remainder * (weights[i] / flex_weight)
        elif widths:
            widths[0] += remainder

    return widths


def _pdf_data_table(
    document: ReportDocument,
    styles: dict[str, ParagraphStyle],
    available_width: float,
) -> Table:
    col_widths = _column_widths(document.headers, document.rows, available_width)
    header_row = [Paragraph(_clean_pdf_text(h), styles["header"]) for h in document.headers]
    body_rows = [
        [Paragraph(_clean_pdf_text(cell), styles["cell"]) for cell in row]
        for row in document.rows
    ]
    table = Table([header_row, *body_rows], colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BRAND_RED),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROW_ALT]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def build_xlsx(document: ReportDocument) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"

    ws.append([document.title])
    ws.append([document.subtitle])
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"].font = Font(size=10)

    if document.summary:
        ws.append([])
        for label, value in document.summary:
            ws.append([label, value])
        for row_idx in range(4, 4 + len(document.summary)):
            ws[f"A{row_idx}"].font = Font(bold=True)

    ws.append([])
    ws.append(document.headers)
    header_row = ws.max_row
    for cell in ws[header_row]:
        cell.font = Font(bold=True)

    for row in document.rows:
        ws.append([_safe_cell(v) for v in row])

    for col_idx, header in enumerate(document.headers, start=1):
        key = _header_key(header)
        max_len = len(header)
        for row in document.rows:
            if col_idx - 1 < len(row):
                max_len = max(max_len, len(_safe_cell(row[col_idx - 1])))
        if key in _FLEXIBLE_HEADERS:
            width_cap = 64
        elif key in _COMPACT_HEADERS:
            width_cap = 16
        else:
            width_cap = 48
        ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 2, width_cap)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _pdf_summary_block(
    document: ReportDocument,
    styles: dict[str, ParagraphStyle],
    available_width: float,
) -> Table | None:
    if not document.summary:
        return None
    rows = [
        [
            Paragraph(_clean_pdf_text(label), styles["summary_label"]),
            Paragraph(_clean_pdf_text(value), styles["summary_value"]),
        ]
        for label, value in document.summary
    ]
    table = Table(rows, colWidths=[available_width * 0.32, available_width * 0.68])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F4F6")),
                ("BACKGROUND", (1, 0), (1, -1), colors.white),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#374151")),
                ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#111827")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def build_pdf(document: ReportDocument) -> bytes:
    buf = io.BytesIO()
    page_size = landscape(A4) if len(document.headers) > 4 else A4
    generated_at = format_generated_at()
    pdf = SimpleDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=PDF_MARGIN,
        rightMargin=PDF_MARGIN,
        topMargin=PDF_MARGIN + HEADER_BAND,
        bottomMargin=PDF_MARGIN + FOOTER_BAND,
    )
    styles = _pdf_styles()
    available_width = page_size[0] - pdf.leftMargin - pdf.rightMargin

    story: list = []
    summary_table = _pdf_summary_block(document, styles, available_width)
    if summary_table is not None:
        story.extend([summary_table, Spacer(1, 12)])

    if not document.rows:
        story.append(Paragraph("No records found for the selected filters.", styles["empty"]))
    else:
        story.append(_pdf_data_table(document, styles, available_width))

    def canvasmaker(*args, **kwargs):
        return ChromeCanvas(
            *args,
            header_title=document.title,
            header_subtitle=document.subtitle,
            generated_at=generated_at,
            **kwargs,
        )

    pdf.build(story, canvasmaker=canvasmaker)
    return buf.getvalue()


def report_filename(report_key: str, fmt: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    ext = "xlsx" if fmt == "xlsx" else "pdf"
    return f"{report_key}_{stamp}.{ext}"


def content_type_for_format(fmt: str) -> str:
    if fmt == "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return "application/pdf"
