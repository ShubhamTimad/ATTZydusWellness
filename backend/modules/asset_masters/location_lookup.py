"""Resolve functional / actual location codes to display names."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.asset_masters.model import ActualLocationMaster, FunctionalLocationMaster


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
