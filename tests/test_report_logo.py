"""Reports show a "Your Logo" placeholder until an admin uploads a logo."""

from __future__ import annotations

from modules.reports import pdf_chrome


def _write_header(monkeypatch, logo: bytes | None):
    from openpyxl import Workbook

    from modules.platform.settings.document_format import DEFAULTS, previewing

    monkeypatch.setattr(pdf_chrome, "logo_png_bytes", lambda: logo)
    wb = Workbook()
    with previewing(DEFAULTS):
        pdf_chrome.write_xlsx_header(wb.active, title="Asset Register Report", ncols=4, generated_by="test")
    return wb.active


def test_no_bundled_logo_without_upload(monkeypatch) -> None:
    import modules.platform.settings.brand_logo as brand_logo

    monkeypatch.setattr(brand_logo, "get_brand_logo_bytes", lambda: None)
    assert pdf_chrome.logo_png_bytes() is None


def test_xlsx_header_shows_placeholder_without_logo(monkeypatch) -> None:
    ws = _write_header(monkeypatch, None)
    assert not ws._images
    values = {c.value for row in ws.iter_rows() for c in row}
    assert pdf_chrome.LOGO_PLACEHOLDER.upper() in values


def test_xlsx_header_embeds_uploaded_logo(monkeypatch) -> None:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (40, 20), "red").save(buf, format="PNG")
    ws = _write_header(monkeypatch, buf.getvalue())
    assert ws._images
