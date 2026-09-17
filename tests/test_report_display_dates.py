"""PDF/Excel display dates match the app (DD/MM/YY, 12-hour time)."""

from __future__ import annotations

from datetime import date, datetime

from modules.reports.pdf_chrome import format_app_date, format_app_datetime, format_generated_at


def test_pdf_dates_match_app_dd_mm_yy() -> None:
    assert format_app_date(date(2026, 9, 11)) == "11/09/26"
    assert format_app_date(datetime(2026, 9, 11, 14, 47)) == "11/09/26"
    assert format_app_date(None) == ""


def test_pdf_datetimes_use_12_hour_clock() -> None:
    assert format_app_datetime(datetime(2026, 9, 11, 14, 47)) == "11/09/26 2:47 PM"
    assert format_app_datetime(datetime(2026, 9, 11, 0, 5)) == "11/09/26 12:05 AM"
    assert format_generated_at(datetime(2026, 9, 11, 14, 47)) == "11/09/26 2:47 PM"
    assert format_app_datetime(None) == ""
