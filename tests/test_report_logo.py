"""Asset register Excel/PDF logo must ship with the backend image."""

from __future__ import annotations

from pathlib import Path

from modules.reports import pdf_chrome


def test_logo_png_is_available_without_frontend_public(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(pdf_chrome, "_PUBLIC", tmp_path / "missing-public")
    data = pdf_chrome.logo_png_bytes()
    assert data is not None
    assert data.startswith(b"\x89PNG")


def test_xlsx_header_embeds_logo() -> None:
    from openpyxl import Workbook

    from modules.platform.settings.document_format import DEFAULTS, previewing
    from modules.reports.pdf_chrome import write_xlsx_header

    wb = Workbook()
    with previewing(DEFAULTS):
        write_xlsx_header(wb.active, title="Asset Register Report", ncols=4, generated_by="test")
    assert wb.active._images
