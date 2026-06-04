"""Financial year boundaries for physical verification checks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from modules.platform.settings.lookup import get_setting

DEFAULT_START_MONTH = 4
DEFAULT_START_DAY = 1


@dataclass(frozen=True)
class FinancialYearConfig:
    start_month: int
    start_day: int


@dataclass(frozen=True)
class FinancialYearPeriod:
    start: date
    end: date
    label: str


def _parse_int_setting(key: str, default: int, *, min_v: int, max_v: int) -> int:
    raw = get_setting(key)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = int(str(raw).strip())
    except ValueError:
        return default
    return max(min_v, min(max_v, value))


def get_financial_year_config() -> FinancialYearConfig:
    return FinancialYearConfig(
        start_month=_parse_int_setting(
            "financial_year.start_month",
            DEFAULT_START_MONTH,
            min_v=1,
            max_v=12,
        ),
        start_day=_parse_int_setting(
            "financial_year.start_day",
            DEFAULT_START_DAY,
            min_v=1,
            max_v=31,
        ),
    )


def _safe_date(year: int, month: int, day: int) -> date:
    while day > 28:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1
    return date(year, month, day)


def financial_year_period_for(
    on_day: date | None = None,
    *,
    config: FinancialYearConfig | None = None,
) -> FinancialYearPeriod:
    cfg = config or get_financial_year_config()
    today = on_day or date.today()
    year = today.year
    start_this_year = _safe_date(year, cfg.start_month, cfg.start_day)
    if today < start_this_year:
        fy_start = _safe_date(year - 1, cfg.start_month, cfg.start_day)
        fy_end = start_this_year - timedelta(days=1)
        label = f"FY {year - 1}–{str(year)[-2:]}"
    else:
        fy_start = start_this_year
        next_start = _safe_date(year + 1, cfg.start_month, cfg.start_day)
        fy_end = next_start - timedelta(days=1)
        label = f"FY {year}–{str(year + 1)[-2:]}"
    return FinancialYearPeriod(start=fy_start, end=fy_end, label=label)


def is_verified_in_financial_year(
    last_verification_date: date | None,
    *,
    on_day: date | None = None,
    config: FinancialYearConfig | None = None,
) -> bool:
    if last_verification_date is None:
        return False
    period = financial_year_period_for(on_day, config=config)
    return period.start <= last_verification_date <= period.end
