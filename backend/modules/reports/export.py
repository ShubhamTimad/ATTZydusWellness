from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

BRAND_RED = colors.HexColor("#E1242A")
ROW_ALT = colors.HexColor("#F8FAFC")
LOGO_PATH = Path(__file__).resolve().parents[3] / "frontend" / "public" / "logo.png"

PDF_MARGIN = 36
PDF_BODY_FONT = 7
PDF_HEADER_FONT = 7.5
PDF_TITLE_FONT = 16
PDF_SUBTITLE_FONT = 9
MIN_COL_WIDTH = 36
MAX_COL_WIDTH = 110


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


def _logo_image():
    """Official app logo from frontend/public/logo.png."""
    if LOGO_PATH.is_file():
        return Image(str(LOGO_PATH), width=1.35 * inch, height=0.42 * inch, kind="proportional")
    fallback = ParagraphStyle(
        "LogoFallback",
        fontName="Helvetica-Bold",
        fontSize=14,
        textColor=BRAND_RED,
    )
    return Paragraph("Takeda", fallback)


def _pdf_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=PDF_TITLE_FONT,
            leading=18,
            textColor=colors.HexColor("#111827"),
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=PDF_SUBTITLE_FONT,
            leading=12,
            textColor=colors.HexColor("#6B7280"),
        ),
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
        max_len = len(header)
        for row in rows:
            if idx < len(row):
                cell = _safe_cell(row[idx])
                max_len = max(max_len, min(len(cell), 48))
        if header.lower() in {"asset name", "asset code", "order number", "rejection reason"}:
            max_len = max(max_len, 18)
        if header.lower() in {"last verification", "scan time", "created at", "completed at"}:
            max_len = max(max_len, 14)
        weights.append(float(max(max_len, 8)))
    return weights


def _column_widths(headers: list[str], rows: list[list[str]], available_width: float) -> list[float]:
    weights = _column_weights(headers, rows)
    total = sum(weights) or 1.0
    raw = [available_width * (w / total) for w in weights]
    clamped = [max(MIN_COL_WIDTH, min(MAX_COL_WIDTH, w)) for w in raw]
    total_clamped = sum(clamped)
    if total_clamped > available_width:
        scale = available_width / total_clamped
        clamped = [w * scale for w in clamped]
    elif total_clamped < available_width:
        clamped[-1] += available_width - total_clamped
    return clamped


def _pdf_header_block(document: ReportDocument, styles: dict[str, ParagraphStyle], width: float) -> Table:
    logo = _logo_image()
    meta = Table(
        [
            [Paragraph(_clean_pdf_text(document.title), styles["title"])],
            [Paragraph(_clean_pdf_text(document.subtitle), styles["subtitle"])],
        ],
        colWidths=[width - 1.55 * inch],
    )
    meta.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    header = Table([[logo, meta]], colWidths=[1.55 * inch, width - 1.55 * inch])
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return header


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


def _draw_page_frame(canvas, doc) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
    canvas.setLineWidth(0.5)
    canvas.line(PDF_MARGIN, 28, doc.pagesize[0] - PDF_MARGIN, 28)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6B7280"))
    canvas.drawString(PDF_MARGIN, 16, "Takeda ATT — Confidential")
    canvas.drawRightString(doc.pagesize[0] - PDF_MARGIN, 16, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


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
        max_len = len(header)
        for row in document.rows:
            if col_idx - 1 < len(row):
                max_len = max(max_len, len(_safe_cell(row[col_idx - 1])))
        ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 2, 48)

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
            Paragraph(_clean_pdf_text(label), styles["header"]),
            Paragraph(_clean_pdf_text(value), styles["cell"]),
        ]
        for label, value in document.summary
    ]
    table = Table(rows, colWidths=[available_width * 0.32, available_width * 0.68])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F4F6")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def build_pdf(document: ReportDocument) -> bytes:
    buf = io.BytesIO()
    page_size = landscape(A4) if len(document.headers) > 4 else A4
    pdf = SimpleDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=PDF_MARGIN,
        rightMargin=PDF_MARGIN,
        topMargin=PDF_MARGIN,
        bottomMargin=42,
    )
    styles = _pdf_styles()
    available_width = page_size[0] - pdf.leftMargin - pdf.rightMargin

    story = [
        _pdf_header_block(document, styles, available_width),
        Spacer(1, 14),
    ]

    summary_table = _pdf_summary_block(document, styles, available_width)
    if summary_table is not None:
        story.extend([summary_table, Spacer(1, 12)])

    if not document.rows:
        story.append(Paragraph("No records found for the selected filters.", styles["empty"]))
    else:
        story.append(_pdf_data_table(document, styles, available_width))

    pdf.build(story, onFirstPage=_draw_page_frame, onLaterPages=_draw_page_frame)
    return buf.getvalue()


def report_filename(report_key: str, fmt: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    ext = "xlsx" if fmt == "xlsx" else "pdf"
    return f"{report_key}_{stamp}.{ext}"


def content_type_for_format(fmt: str) -> str:
    if fmt == "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return "application/pdf"
