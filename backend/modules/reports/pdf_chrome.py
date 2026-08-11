"""Shared PDF page chrome — keep copy in sync with frontend/src/pages/capex/capex-print-form.tsx."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as pdfcanvas

BRAND_RED = colors.HexColor("#E1242A")
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
RULE = colors.HexColor("#D1D5DB")

ORG_NAME = "Takeda"
PRODUCT_NAME = "Asset Tagging & Tracking"
FOOTER_BRAND = f"{ORG_NAME} · {PRODUCT_NAME}"
CONFIDENTIAL_LINE = "Confidential — internal use only"

PAGE_MARGIN = 36
HEADER_BAND = 58
FOOTER_BAND = 32

_PUBLIC = Path(__file__).resolve().parents[3] / "frontend" / "public"


def format_generated_at(when: datetime | None = None) -> str:
    dt = when or datetime.now()
    return dt.strftime("%d.%m.%Y %H:%M")


def logo_image_path() -> Path | None:
    for name in ("logo.png", "logo.jpg"):
        path = _PUBLIC / name
        if path.is_file():
            return path
    return None


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

    logo = logo_image_path()
    text_left = left
    if logo is not None:
        canvas.drawImage(
            str(logo),
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
        canvas.drawString(left, top - 14, ORG_NAME.upper())
        text_left = left + 72

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(text_left, top - 6, PRODUCT_NAME.upper())

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

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(right, top - 22, CONFIDENTIAL_LINE)

    rule_y = top - HEADER_BAND + 10
    canvas.setStrokeColor(BRAND_RED)
    canvas.setLineWidth(2)
    canvas.line(left, rule_y, right, rule_y)


def draw_footer(
    canvas: pdfcanvas.Canvas,
    *,
    page: int,
    page_count: int,
) -> None:
    width, _height = canvas._pagesize
    left = PAGE_MARGIN
    right = width - PAGE_MARGIN
    y = PAGE_MARGIN - 6

    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(left, y + 14, right, y + 14)

    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(left, y + 2, FOOTER_BRAND)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(left, y - 10, CONFIDENTIAL_LINE)

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(right, y + 2, f"Page {page} of {page_count}")
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(right, y - 10, "System-generated")


class ChromeCanvas(pdfcanvas.Canvas):
    """Repeats the standard header/footer and fills in Page X of Y."""

    def __init__(
        self,
        *args,
        header_title: str = "",
        header_subtitle: str = "",
        generated_at: str = "",
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []
        self._header_title = header_title
        self._header_subtitle = header_subtitle
        self._generated_at = generated_at

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
            draw_footer(self, page=int(self._pageNumber), page_count=page_count)
            pdfcanvas.Canvas.showPage(self)
        pdfcanvas.Canvas.save(self)
