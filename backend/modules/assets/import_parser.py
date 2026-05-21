from __future__ import annotations

import csv
import io
from typing import Any

from modules.assets.field_definitions import IMPORT_COLUMN_ALIASES
from modules.assets.import_row_mapper import normalize_import_row
from modules.assets.schema import ImportPreviewRow


def _normalize_header(h: str) -> str:
    return (h or "").strip().lower().replace("_", " ")


def _map_headers(raw_headers: list[str]) -> dict[int, str]:
    out: dict[int, str] = {}
    alias_lookup: dict[str, str] = {}
    for canonical, aliases in IMPORT_COLUMN_ALIASES.items():
        for a in aliases:
            alias_lookup[_normalize_header(a)] = canonical
    for idx, raw in enumerate(raw_headers):
        key = alias_lookup.get(_normalize_header(raw))
        if key:
            out[idx] = key
    return out


def _parse_row(mapped: dict[str, str], row_number: int) -> ImportPreviewRow:
    data = normalize_import_row(
        {k: (v.strip() if isinstance(v, str) else v) for k, v in mapped.items() if v not in (None, "")}
    )
    return ImportPreviewRow(
        row_number=row_number,
        valid=False,
        errors=[],
        field_errors={},
        data=data,
    )


def parse_upload_file(*, filename: str | None, content: bytes) -> list[ImportPreviewRow]:
    name = (filename or "").lower()
    if name.endswith(".csv") or not name.endswith((".xlsx", ".xls")):
        text = content.decode("utf-8-sig", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows_iter = list(reader)
        if not rows_iter:
            return []
        header_map = _map_headers(rows_iter[0])
        out: list[ImportPreviewRow] = []
        for i, row in enumerate(rows_iter[1:], start=2):
            mapped = {header_map[j]: row[j] for j in header_map if j < len(row)}
            out.append(_parse_row(mapped, i))
        return out

    try:
        import openpyxl
    except ImportError as exc:
        raise ValueError("Excel import requires openpyxl. Install it or upload CSV.") from exc

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows_iter = list(ws.iter_rows(values_only=True))
    if not rows_iter:
        return []
    headers = [str(c or "") for c in rows_iter[0]]
    header_map = _map_headers(headers)
    out = []
    for i, row in enumerate(rows_iter[1:], start=2):
        cells = [str(c).strip() if c is not None else "" for c in row]
        mapped = {header_map[j]: cells[j] for j in header_map if j < len(cells)}
        out.append(_parse_row(mapped, i))
    return out
