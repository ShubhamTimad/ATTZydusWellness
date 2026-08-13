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
CONFIDENTIAL_LINE = "Confidential — internal use only"


def _chrome_strings():
    from modules.platform.settings.document_format import footer_brand, get_document_format

    fmt = get_document_format()
    return (
        fmt.org_name.strip() or ORG_NAME,
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


XLSX_TOP_PAD_ROWS = 4
XLSX_LEFT_PAD_COLS = 4
# Top pad + logo/title row + subtitle row + spacer + rule
XLSX_HEADER_ROWS = XLSX_TOP_PAD_ROWS + 4


def xlsx_pad_row(values: list, *, ncols: int) -> list:
    """Leading blank column for left margin; pad to ncols data columns."""
    cells = list(values)
    if len(cells) < ncols:
        cells.extend([None] * (ncols - len(cells)))
    elif len(cells) > ncols:
        cells = cells[:ncols]
    return [None] * XLSX_LEFT_PAD_COLS + cells


def write_xlsx_header(
    ws,
    *,
    title: str,
    subtitle: str = "",
    ncols: int,
    generated_by: str = "",
) -> int:
    """Logo + title band with top/left padding. Returns first body row (1-based)."""
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Alignment, Border, Font, Side
    from openpyxl.utils import get_column_letter

    ncols = max(int(ncols), 4)
    last_data_col = XLSX_LEFT_PAD_COLS + ncols
    org_name, _confidential, _brand = _chrome_strings()
    generated_at = format_generated_at()
    by = generated_by.strip()

    # Columns A–D = left margin; logo in E–F; title from G.
    logo_col = XLSX_LEFT_PAD_COLS + 1
    text_col = XLSX_LEFT_PAD_COLS + 3
    first_row = XLSX_TOP_PAD_ROWS + 1
    title_row = first_row
    subtitle_row = first_row + 1
    rule_row = XLSX_HEADER_ROWS

    for r in range(1, XLSX_TOP_PAD_ROWS + 1):
        ws.row_dimensions[r].height = 12
    ws.row_dimensions[title_row].height = 22
    ws.row_dimensions[subtitle_row].height = 18
    ws.row_dimensions[subtitle_row + 1].height = 10
    ws.row_dimensions[rule_row].height = 8

    for c in range(1, XLSX_LEFT_PAD_COLS + 1):
        ws.column_dimensions[get_column_letter(c)].width = 4
    ws.column_dimensions[get_column_letter(logo_col)].width = 14
    ws.column_dimensions[get_column_letter(logo_col + 1)].width = 8

    logo_end = get_column_letter(logo_col + 1)
    text_last = get_column_letter(last_data_col)
    logo_start = get_column_letter(logo_col)
    ws.merge_cells(f"{logo_start}{title_row}:{logo_end}{rule_row - 1}")
    if last_data_col > text_col:
        ws.merge_cells(f"{get_column_letter(text_col)}{title_row}:{text_last}{title_row}")
        ws.merge_cells(f"{get_column_letter(text_col)}{subtitle_row}:{text_last}{subtitle_row}")

    png = logo_png_bytes()
    logo_anchor = f"{logo_start}{title_row}"
    if png is not None:
        img = XLImage(io.BytesIO(png))
        img.width = 118
        img.height = 36
        ws.add_image(img, logo_anchor)
    else:
        cell = ws.cell(title_row, logo_col, org_name)
        cell.font = Font(name="Calibri", bold=True, size=14, color="E1242A")

    display_title = (title or "").strip()[:90]
    title_cell = ws.cell(title_row, text_col, display_title)
    title_cell.font = Font(name="Calibri", bold=True, size=14, color="111827")
    title_cell.alignment = Alignment(vertical="center")

    # Who / when sit under the title in the heading band.
    who = by or "—"
    heading_meta = f"Generated by {who} · Generated on {generated_at}"
    if subtitle.strip():
        heading_meta = f"{subtitle.strip()[:80]}  ·  {heading_meta}"
    meta_cell = ws.cell(subtitle_row, text_col, heading_meta[:160])
    meta_cell.font = Font(name="Calibri", size=9, color="6B7280")
    meta_cell.alignment = Alignment(vertical="center")

    rule = Border(bottom=Side(style="medium", color="E1242A"))
    for col in range(logo_col, last_data_col + 1):
        ws.cell(rule_row, col).border = rule
    return XLSX_HEADER_ROWS + 1


def paint_xlsx_margins_white(ws, *, ncols: int) -> None:
    """Fill top 4 rows and left 4 columns solid white so the margin looks blank."""
    from openpyxl.styles import Border, PatternFill
    from openpyxl.utils import get_column_letter

    white = PatternFill(fill_type="solid", fgColor="FFFFFF")
    no_border = Border()
    last_col = max(XLSX_LEFT_PAD_COLS + max(int(ncols), 4), ws.max_column or 1)
    last_row = max(ws.max_row or 1, XLSX_HEADER_ROWS + 1)

    for row in range(1, XLSX_TOP_PAD_ROWS + 1):
        for col in range(1, last_col + 1):
            cell = ws.cell(row, col)
            cell.fill = white
            cell.border = no_border
            cell.value = None

    for col in range(1, XLSX_LEFT_PAD_COLS + 1):
        ws.column_dimensions[get_column_letter(col)].width = 4
        for row in range(1, last_row + 1):
            cell = ws.cell(row, col)
            cell.fill = white
            cell.border = no_border
            cell.value = None


def apply_xlsx_print_chrome(ws, *, ncols: int, generated_by: str = "") -> None:
    """Freeze/repeat the header; print footer on every page — body sits between."""
    from openpyxl.worksheet.page import PageMargins
    from openpyxl.utils import get_column_letter

    _org, confidential_line, brand = _chrome_strings()
    by = generated_by.strip()
    first_body = XLSX_HEADER_ROWS + 1
    left_data = get_column_letter(XLSX_LEFT_PAD_COLS + 1)
    ws.freeze_panes = f"{left_data}{first_body}"
    ws.print_title_rows = f"1:{XLSX_HEADER_ROWS}"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if ncols > 4 else "portrait"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins = PageMargins(left=0.55, right=0.5, top=0.6, bottom=0.7, header=0.2, footer=0.45)
    ws.oddFooter.left.text = f"&B{brand}\n{confidential_line}"
    ws.oddFooter.right.text = f"Page &P of &N\nGenerated by {by}" if by else "Page &P of &N"
    ws.oddFooter.left.size = 8
    ws.oddFooter.right.size = 8
    ws.oddHeader.left.text = ""
    ws.sheet_view.showGridLines = False
    paint_xlsx_margins_white(ws, ncols=ncols)


def apply_xlsx_data_layout(
    ws,
    *,
    ncols: int,
    header_row: int,
    data_last_row: int | None = None,
    min_width: float = 12,
    standard_width: float = 22,
    max_width: float = 36,
) -> None:
    """Size data columns, wrap text, and draw thin grid lines around the data box."""
    from openpyxl.styles import Alignment, Border, Font, Side
    from openpyxl.utils import get_column_letter

    wrap = Alignment(wrap_text=True, vertical="top")
    header_font = Font(bold=True)
    thin = Side(style="thin", color="D1D5DB")
    grid = Border(left=thin, right=thin, top=thin, bottom=thin)
    first_col = XLSX_LEFT_PAD_COLS + 1
    last_col = XLSX_LEFT_PAD_COLS + ncols
    end_row = int(data_last_row) if data_last_row is not None else int(ws.max_row or header_row)

    for col_idx in range(first_col, last_col + 1):
        letter = get_column_letter(col_idx)
        max_len = 0
        for excel_row in ws.iter_rows(
            min_col=col_idx, max_col=col_idx, min_row=header_row, max_row=end_row
        ):
            cell = excel_row[0]
            if cell.value is not None:
                text = str(cell.value)
                # Longest line if value already contains newlines.
                max_len = max(max_len, max((len(part) for part in text.splitlines()), default=0))
            cell.alignment = wrap
            cell.border = grid
            if cell.row == header_row:
                cell.font = header_font
        # Grow with content up to standard, then cap — longer text wraps.
        width = max(min_width, min(max(max_len + 2, standard_width), max_width))
        ws.column_dimensions[letter].width = width

    # Keep left margin narrow after data sizing.
    for c in range(1, XLSX_LEFT_PAD_COLS + 1):
        ws.column_dimensions[get_column_letter(c)].width = 4


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

    org_name, _confidential, _footer = _chrome_strings()
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

    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(text_left, top - 14, (title or "").strip()[:90])

    if subtitle.strip():
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(text_left, top - 30, subtitle.strip()[:110])

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

    _org, confidential_line, brand = _chrome_strings()
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
