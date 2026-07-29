"""The disposal UI hard-codes tab keys and status labels; fail here when the backend drifts."""

from __future__ import annotations

import re
from pathlib import Path

from modules.disposals.constants import STATUS_LABELS
from modules.disposals.service import _TAB_STATUSES

TYPES_FILE = Path(__file__).resolve().parents[1] / "frontend/src/lib/disposal-types.ts"


def _ts_source() -> str:
    return TYPES_FILE.read_text(encoding="utf-8")


def test_status_tabs_match_backend_tabs() -> None:
    block = re.search(r"DISPOSAL_STATUS_TABS = \[(.*?)\] as const", _ts_source(), re.S)
    assert block is not None, "DISPOSAL_STATUS_TABS not found"
    keys = re.findall(r'key:\s*"([^"]+)"', block.group(1))
    assert set(keys) == set(_TAB_STATUSES)


def test_every_backend_status_has_a_ui_label() -> None:
    block = re.search(r"function disposalStatusLabel.*?\n}", _ts_source(), re.S)
    assert block is not None, "disposalStatusLabel not found"
    labelled = set(re.findall(r"^\s{4}(\w+):", block.group(0), re.M))
    assert set(STATUS_LABELS) <= labelled
