"""Resolve functional / actual location codes to display names."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
)
from modules.assets.model import AssetMaster

_FL_KEYS = ("to_functional_location", "functional_location", "from_functional_location")
_AL_KEYS = ("to_actual_location", "actual_location", "from_actual_location")
_CC_KEYS = ("to_cost_center", "cost_center", "from_cost_center")


def location_display_name(
    name: str | None,
    code: str | None,
    description: str | None = None,
) -> str | None:
    n = (name or "").strip()
    d = (description or "").strip()
    c = (code or "").strip()
    # Prefer a human label: name, then description, then code.
    # If name is just a duplicate of the code, prefer description when present.
    if n and (not c or n.casefold() != c.casefold()):
        return n
    if d:
        return d
    if n:
        return n
    return c or None


def resolve_plant_location_names(
    db: Session,
    *,
    plant_id: int,
    functional_location_code: str | None,
    actual_location_code: str | None = None,
) -> tuple[str | None, str | None]:
    """Return (functional_location_name, actual_location_name) for plant-scoped codes."""
    fl_code = (functional_location_code or "").strip()
    al_code = (actual_location_code or "").strip()
    if not fl_code:
        return None, None
    fl = db.scalar(
        select(FunctionalLocationMaster).where(
            FunctionalLocationMaster.plant_id == int(plant_id),
            FunctionalLocationMaster.code.ilike(fl_code),
        )
    )
    if fl is None:
        return fl_code, al_code or None
    fl_name = location_display_name(fl.name, fl.code, fl.description)
    if not al_code:
        return fl_name, None
    al = db.scalar(
        select(ActualLocationMaster).where(
            ActualLocationMaster.functional_location_id == int(fl.id),
            ActualLocationMaster.code.ilike(al_code),
        )
    )
    if al is None:
        return fl_name, al_code
    return fl_name, location_display_name(al.name, al.code, al.description)


def resolve_cost_center_name(
    db: Session,
    *,
    plant_id: int,
    code: str | None,
) -> str | None:
    cc_code = (code or "").strip()
    if not cc_code:
        return None
    row = db.scalar(
        select(CostCenterMaster).where(
            CostCenterMaster.plant_id == int(plant_id),
            CostCenterMaster.code.ilike(cc_code),
        )
    )
    if row is None:
        return cc_code
    return location_display_name(row.name, row.code, row.description) or cc_code


def plant_code_display_map(db: Session, plant_id: int) -> dict[str, str]:
    """Master code → display name for FL / AL / CC / PC in this plant.

    Keys are prefixed (``fl:``, ``al:``, ``al:{fl}:{al}``, ``cc:``, ``pc:``) so
    Actual Location 1 and Actual Location 2 can share a code without colliding.
    Unprefixed keys are kept for cost/profit centers (and as a lookup fallback).
    """
    labels: dict[str, str] = {}
    fl_rows = list(
        db.scalars(
            select(FunctionalLocationMaster).where(
                FunctionalLocationMaster.plant_id == int(plant_id)
            )
        ).all()
    )
    fl_by_id = {int(r.id): r for r in fl_rows}
    for row in fl_rows:
        name = location_display_name(row.name, row.code, row.description)
        if name:
            labels[f"fl:{row.code.strip().casefold()}"] = name
    if fl_by_id:
        for row in db.scalars(
            select(ActualLocationMaster).where(
                ActualLocationMaster.functional_location_id.in_(list(fl_by_id))
            )
        ).all():
            name = location_display_name(row.name, row.code, row.description)
            if not name:
                continue
            al_key = row.code.strip().casefold()
            labels[f"al:{al_key}"] = name
            fl = fl_by_id.get(int(row.functional_location_id))
            if fl is not None:
                labels[f"al:{fl.code.strip().casefold()}:{al_key}"] = name
    cc_rows = list(
        db.scalars(
            select(CostCenterMaster).where(CostCenterMaster.plant_id == int(plant_id))
        ).all()
    )
    cc_ids = [int(r.id) for r in cc_rows]
    for row in cc_rows:
        name = location_display_name(row.name, row.code, row.description)
        if name:
            folded = row.code.strip().casefold()
            labels[f"cc:{folded}"] = name
            labels[folded] = name
    if cc_ids:
        for row in db.scalars(
            select(ProfitCenterMaster).where(ProfitCenterMaster.cost_center_id.in_(cc_ids))
        ).all():
            name = location_display_name(row.name, row.code, row.description)
            if name:
                folded = row.code.strip().casefold()
                labels[f"pc:{folded}"] = name
                labels[folded] = name
    return labels


def rewrite_audit_master_codes(
    db: Session,
    payload: dict[str, Any] | None,
    *,
    plant_id: int | None,
    cache: dict[tuple, Any] | None = None,
) -> dict[str, Any] | None:
    """Replace stored location / cost-center codes with display names for the audit UI."""
    if not payload:
        return payload
    out = dict(payload)
    if not plant_id:
        return out
    store = cache if cache is not None else {}

    def loc_names(fl: str | None, al: str | None) -> tuple[str | None, str | None]:
        key = ("loc", int(plant_id), (fl or "").strip().casefold(), (al or "").strip().casefold())
        if key not in store:
            store[key] = resolve_plant_location_names(
                db,
                plant_id=int(plant_id),
                functional_location_code=fl,
                actual_location_code=al,
            )
        return store[key]

    def cc_name(code: Any) -> Any:
        if not isinstance(code, str) or not code.strip():
            return code
        key = ("cc", int(plant_id), code.strip().casefold())
        if key not in store:
            store[key] = resolve_cost_center_name(db, plant_id=int(plant_id), code=code)
        return store[key] or code

    def rewrite_row(row: dict[str, Any]) -> dict[str, Any]:
        rewritten = dict(row)
        for fl_key in _FL_KEYS:
            fl_code = row.get(fl_key)
            if not isinstance(fl_code, str) or not fl_code.strip():
                continue
            al_key = fl_key.replace("functional_location", "actual_location")
            al_code = row.get(al_key) if isinstance(row.get(al_key), str) else None
            fl_n, al_n = loc_names(fl_code, al_code)
            if fl_n:
                rewritten[fl_key] = fl_n
            if al_n and al_key in rewritten:
                rewritten[al_key] = al_n
        for al_key in _AL_KEYS:
            al_code = row.get(al_key)
            if not isinstance(al_code, str) or not al_code.strip():
                continue
            if al_key in rewritten and rewritten.get(al_key) != al_code:
                continue
            fl_key = al_key.replace("actual_location", "functional_location")
            fl_code = row.get(fl_key) if isinstance(row.get(fl_key), str) else None
            if not fl_code:
                continue
            _, al_n = loc_names(fl_code, al_code)
            if al_n:
                rewritten[al_key] = al_n
        for cc_key in _CC_KEYS:
            if cc_key in rewritten:
                rewritten[cc_key] = cc_name(row.get(cc_key))
        return rewritten

    def asset_name(code: Any) -> str | None:
        if not isinstance(code, str) or not code.strip():
            return None
        key = ("asset_name", code.strip())
        if key not in store:
            # ponytail: matches by code only; older events did not store the asset id.
            store[key] = db.scalar(
                select(AssetMaster.asset_name).where(AssetMaster.asset_code == code.strip()).limit(1)
            )
        return store[key]

    def rewrite_item(row: dict[str, Any]) -> dict[str, Any]:
        rewritten = rewrite_row(row)
        if not rewritten.get("asset_name"):
            rewritten["asset_name"] = asset_name(row.get("asset_code"))
        return rewritten

    out = rewrite_row(out)
    items = out.get("item_locations")
    if isinstance(items, list):
        out["item_locations"] = [
            rewrite_item(row) if isinstance(row, dict) else row for row in items
        ]
    return out
