"""Shared PDF/Excel page chrome — keep copy in sync with frontend/src/pages/capex/capex-print-form.tsx."""

from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdfcanvas

BRAND_RED = colors.HexColor("#E1242A")
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
RULE = colors.HexColor("#D1D5DB")

ORG_NAME = "Takeda"
PRODUCT_NAME = "Asset Tagging & Tracking"
FOOTER_BRAND = f"{ORG_NAME} · {PRODUCT_NAME}"
CONFIDENTIAL_LINE = "Confidential — internal use only"


def _chrome_strings():
    from modules.platform.settings.document_format import footer_brand, get_document_format

    fmt = get_document_format()
    return (
        fmt.org_name.strip() or ORG_NAME,
        fmt.product_name.strip() or PRODUCT_NAME,
        fmt.confidential_line.strip() or CONFIDENTIAL_LINE,
        footer_brand(fmt),
    )

PAGE_MARGIN = 36
HEADER_BAND = 58
FOOTER_BAND = 36
SIG_BAND = 72

_PUBLIC = Path(__file__).resolve().parents[3] / "frontend" / "public"


def format_generated_at(when: datetime | None = None) -> str:
    dt = when or datetime.now()
    return dt.strftime("%d.%m.%Y %H:%M")


def logo_png_bytes() -> bytes | None:
    """Raster logo for Excel/PDF. PNG/JPG as-is; SVG drawn with Pillow."""
    for name in ("logo.png", "logo.jpg"):
        path = _PUBLIC / name
        if path.is_file():
            return path.read_bytes()
    svg = _PUBLIC / "logo.svg"
    if svg.is_file():
        return _rasterize_takeda_mark()
    return None


def _rasterize_takeda_mark() -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    w, h = 376, 112
    img = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    red = (225, 36, 42, 255)
    scale = 2.0

    def cubic(p0, p1, p2, p3, steps=28):
        pts = []
        for i in range(steps + 1):
            t = i / steps
            u = 1 - t
            x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
            y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
            pts.append((x * scale, y * scale))
        return pts

    draw.line(cubic((30, 20), (54, 4), (134, 4), (158, 20)), fill=red, width=8, joint="curve")
    draw.line(cubic((34, 38), (56, 50), (132, 50), (154, 38)), fill=red, width=6, joint="curve")
    font = None
    for candidate in (
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/Library/Fonts/Georgia.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
    ):
        if Path(candidate).is_file():
            font = ImageFont.truetype(candidate, 54)
            break
    if font is None:
        font = ImageFont.load_default()
    draw.text((188 * scale, 32 * scale), "Takeda", fill=red, font=font, anchor="mm")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


XLSX_HEADER_ROWS = 4


def write_xlsx_header(ws, *, title: str, subtitle: str = "", ncols: int) -> int:
    """Logo + product/title/confidential band. Returns first body row (1-based)."""
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Alignment, Border, Font, Side
    from openpyxl.utils import get_column_letter

    ncols = max(int(ncols), 4)
    org_name, product_name, _confidential, _brand = _chrome_strings()
    generated = format_generated_at()
    text_col = 3
    text_last = get_column_letter(ncols - 1)
    ws.merge_cells(f"A1:B{XLSX_HEADER_ROWS}")
    if ncols - 1 > text_col:
        ws.merge_cells(f"C1:{text_last}1")
        ws.merge_cells(f"C2:{text_last}2")
        if subtitle.strip():
            ws.merge_cells(f"C3:{text_last}3")
    ws.row_dimensions[1].height = 18
    ws.row_dimensions[2].height = 18
    ws.row_dimensions[3].height = 16
    ws.row_dimensions[4].height = 10
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 8

    png = logo_png_bytes()
    if png is not None:
        img = XLImage(io.BytesIO(png))
        img.width = 118
        img.height = 36
        ws.add_image(img, "A1")
    else:
        cell = ws["A1"]
        cell.value = org_name
        cell.font = Font(name="Calibri", bold=True, size=14, color="E1242A")

    ws.cell(1, text_col, product_name.upper()).font = Font(name="Calibri", size=9, color="6B7280", bold=True)
    ws.cell(2, text_col, (title or "").strip()[:90]).font = Font(name="Calibri", bold=True, size=13, color="111827")
    if subtitle.strip():
        ws.cell(3, text_col, subtitle.strip()[:110]).font = Font(name="Calibri", size=9, color="6B7280")
    ws.cell(1, ncols, f"Generated: {generated}").font = Font(name="Calibri", size=9, color="6B7280")
    ws.cell(1, ncols).alignment = Alignment(horizontal="right")
    rule = Border(bottom=Side(style="medium", color="E1242A"))
    for col in range(1, ncols + 1):
        ws.cell(XLSX_HEADER_ROWS, col).border = rule
    return XLSX_HEADER_ROWS + 1


def apply_xlsx_print_chrome(ws, *, ncols: int, generated_by: str = "") -> None:
    """Freeze/repeat the header; print footer on every page — body sits between."""
    from openpyxl.worksheet.page import PageMargins

    _org, _product, confidential_line, brand = _chrome_strings()
    by = generated_by.strip()
    ws.freeze_panes = f"A{XLSX_HEADER_ROWS + 1}"
    ws.print_title_rows = f"1:{XLSX_HEADER_ROWS}"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if ncols > 4 else "portrait"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.55, bottom=0.7, header=0.2, footer=0.45)
    ws.oddFooter.left.text = f"&B{brand}\n{confidential_line}"
    ws.oddFooter.right.text = f"Page &P of &N\nGenerated by {by}" if by else "Page &P of &N"
    ws.oddFooter.left.size = 8
    ws.oddFooter.right.size = 8
    ws.oddHeader.left.text = ""


def draw_header(
    canvas: pdfcanvas.Canvas,
    *,
    title: str,
    subtitle: str = "",
    generated_at: str = "",
) -> None:
    width, height = canvas._pagesize
    top = height - PAGE_MARGIN
    left = PAGE_MARGIN
    right = width - PAGE_MARGIN

    org_name, product_name, _confidential, _footer = _chrome_strings()
    logo = logo_png_bytes()
    text_left = left
    if logo is not None:
        canvas.drawImage(
            ImageReader(io.BytesIO(logo)),
            left,
            top - 28,
            width=1.28 * inch,
            height=0.38 * inch,
            preserveAspectRatio=True,
            mask="auto",
            anchor="sw",
        )
        text_left = left + 1.38 * inch
    else:
        canvas.setFillColor(BRAND_RED)
        canvas.setFont("Helvetica-Bold", 13)
        canvas.drawString(left, top - 14, org_name.upper())
        text_left = left + 72

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(text_left, top - 6, product_name.upper())

    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(text_left, top - 22, (title or "").strip()[:90])

    if subtitle.strip():
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(text_left, top - 36, subtitle.strip()[:110])

    if generated_at:
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(right, top - 6, f"Generated: {generated_at}")

    rule_y = top - HEADER_BAND + 10
    canvas.setStrokeColor(BRAND_RED)
    canvas.setLineWidth(2)
    canvas.line(left, rule_y, right, rule_y)


def draw_footer(
    canvas: pdfcanvas.Canvas,
    *,
    page: int,
    page_count: int,
    generated_by: str = "",
) -> None:
    width, _height = canvas._pagesize
    left = PAGE_MARGIN
    right = width - PAGE_MARGIN
    y = PAGE_MARGIN - 4

    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(left, y + 16, right, y + 16)

    _org, _product, confidential_line, brand = _chrome_strings()
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(left, y + 4, brand)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(left, y - 8, confidential_line)

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(right, y + 4, f"Page {page} of {page_count}")
    canvas.setFont("Helvetica", 7.5)
    by = generated_by.strip()
    canvas.drawRightString(right, y - 8, f"Generated by {by}" if by else "Generated by —")


def draw_signatures_above_footer(
    canvas: pdfcanvas.Canvas,
    blocks: tuple[tuple[str, str, str], ...],
) -> None:
    """Last-page signature lines, sitting immediately above the footer rule."""
    items = blocks or (("Prepared by", "", ""), ("Approved by", "", ""))
    width, _height = canvas._pagesize
    left = PAGE_MARGIN
    right = width - PAGE_MARGIN
    footer_rule = PAGE_MARGIN + 12
    col_w = (right - left) / len(items)
    label_y = footer_rule + 56
    line_y = footer_rule + 32
    for i, (label, name, date) in enumerate(items):
        x = left + i * col_w
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(x, label_y, f"{label.rstrip(':')}:")
        canvas.setStrokeColor(INK)
        canvas.setLineWidth(0.6)
        canvas.line(x, line_y, x + col_w - 14, line_y)
        if name:
            canvas.setFillColor(INK)
            canvas.setFont("Times-Italic", 11)
            canvas.drawString(x, line_y + 3, name[:36])
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(x, line_y - 12, f"Name: {name}" if name else "Name:")
        canvas.drawString(x, line_y - 24, f"Date: {date}" if date else "Date:")


class ChromeCanvas(pdfcanvas.Canvas):
    """Repeats the standard header/footer and fills in Page X of Y."""

    def __init__(
        self,
        *args,
        header_title: str = "",
        header_subtitle: str = "",
        generated_at: str = "",
        generated_by: str = "",
        signature_blocks: tuple[tuple[str, str, str], ...] = (),
        show_signatures: bool = False,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []
        self._header_title = header_title
        self._header_subtitle = header_subtitle
        self._generated_at = generated_at
        self._generated_by = generated_by
        self._signature_blocks = signature_blocks
        self._show_signatures = show_signatures

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            draw_header(
                self,
                title=self._header_title,
                subtitle=self._header_subtitle,
                generated_at=self._generated_at,
            )
            page = int(self._pageNumber)
            if self._show_signatures and page == page_count:
                draw_signatures_above_footer(self, self._signature_blocks)
            draw_footer(self, page=page, page_count=page_count, generated_by=self._generated_by)
            pdfcanvas.Canvas.showPage(self)
        pdfcanvas.Canvas.save(self)
