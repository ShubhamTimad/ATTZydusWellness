from __future__ import annotations

import csv
import io
from typing import Any

from modules.assets.schema import ImportPreviewRow

# Canonical column headers (case-insensitive match)
COLUMN_ALIASES: dict[str, list[str]] = {
    "asset_name": ["asset name", "asset_name", "name"],
    "asset_code": ["asset code", "asset_code", "code"],
    "rfid_code": ["rfid", "rfid code", "rfid_code", "uhf_rfid_code"],
    "serial_no": ["serial", "serial no", "serial_no"],
    "category_code": ["category", "category code", "asset category", "asset_category"],
    "plant_code": ["plant", "plant code", "plant_code"],
    "functional_location": ["functional location", "functional_location"],
    "actual_location": ["actual location", "actual_location", "location"],
    "cost_center": ["cost center", "cost_center"],
    "inventory_count": ["inventory count", "inventory_count"],
    "physical_count": ["physical count", "physical_count"],
    "inventory_no": ["inventory no", "inventory_no"],
    "asset_description": ["description", "asset description", "asset_description"],
    "vendor_name": ["vendor", "vendor name", "vendor_name"],
    "po_number": ["po", "po number", "po_number"],
    "currency": ["currency"],
}


def _normalize_header(h: str) -> str:
    return (h or "").strip().lower().replace("_", " ")


def _map_headers(raw_headers: list[str]) -> dict[int, str]:
    out: dict[int, str] = {}
    alias_lookup: dict[str, str] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            alias_lookup[_normalize_header(a)] = canonical
    for idx, raw in enumerate(raw_headers):
        key = alias_lookup.get(_normalize_header(raw))
        if key:
            out[idx] = key
    return out


def _parse_row(mapped: dict[str, str], row_number: int) -> ImportPreviewRow:
    errors: list[str] = []
    data = {k: (v.strip() if isinstance(v, str) else v) for k, v in mapped.items() if v not in (None, "")}

    if not data.get("asset_name"):
        errors.append("Asset name is required.")
    if not data.get("asset_code"):
        errors.append("Asset code is required.")

    for int_field in ("inventory_count", "physical_count"):
        if data.get(int_field) is not None:
            try:
                data[int_field] = int(str(data[int_field]).replace(",", ""))
            except ValueError:
                errors.append(f"{int_field} must be a number.")

    return ImportPreviewRow(
        row_number=row_number,
        valid=len(errors) == 0,
        errors=errors,
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
