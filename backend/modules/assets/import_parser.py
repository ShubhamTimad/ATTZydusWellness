from __future__ import annotations

import csv
import io
from typing import Any

from modules.assets.field_definitions import IMPORT_COLUMN_ALIASES
from modules.assets.import_row_mapper import normalize_import_row
from modules.assets.schema import ImportPreviewRow


def _normalize_header(h: str) -> str:
    s = (h or "").strip().lower().replace("_", " ").replace("/", " ")
    # Import template marks required columns with a trailing "*".
    if s.endswith("*"):
        s = s[:-1].rstrip()
    return " ".join(s.split())


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


def is_blank_import_row(data: dict[str, Any]) -> bool:
    """True when every cell in the row is empty (template padding rows, etc.)."""
    if not data:
        return True
    for value in data.values():
        if value is None:
            continue
        if isinstance(value, str):
            if value.strip():
                return False
        else:
            return False
    return True


def _parse_row(mapped: dict[str, str], row_number: int) -> ImportPreviewRow | None:
    data = normalize_import_row(
        {k: (v.strip() if isinstance(v, str) else v) for k, v in mapped.items() if v not in (None, "")}
    )
    if is_blank_import_row(data):
        return None
    return ImportPreviewRow(
        row_number=row_number,
        valid=False,
        errors=[],
        field_errors={},
        data=data,
    )


def _cell_to_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).strip()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # Excel often stores whole numbers as floats (10004.0).
        if value.is_integer():
            return str(int(value))
        return str(value).strip()
    return str(value).strip()


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
            parsed = _parse_row(mapped, i)
            if parsed is not None:
                out.append(parsed)
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
        cells = [_cell_to_str(c) for c in row]
        mapped = {header_map[j]: cells[j] for j in header_map if j < len(cells)}
        parsed = _parse_row(mapped, i)
        if parsed is not None:
            out.append(parsed)
    return out
