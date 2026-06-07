#!/usr/bin/env python3
"""Seed financial-year physical verification dummy data for UI testing.

Creates ``physical_order_verified`` audit events at specific dates so FY tagging
shows varied scan counts and verification states.

Run from the project root (after seed_dummy_data.py)::

    ./venv/bin/python scripts/seed_fy_verification_demo.py
    ./venv/bin/python scripts/seed_fy_verification_demo.py --reset

Scenarios (RFID assets):

| Asset         | Current FY                         | Previous FY   |
|---------------|------------------------------------|---------------|
| DEMO-AST-001  | 2 scans (Jun + recent)             | —             |
| DEMO-AST-002  | 1 scan                             | —             |
| DEMO-AST-004  | pending (no scan)                  | 1 scan        |
| DEMO-AST-006  | 3 scans (re-audit demo)            | —             |
| DEMO-AST-007  | pending                            | 2 scans       |
| DEMO-AST-012  | 1 scan                             | 1 scan        |
| DEMO-AST-010  | 1 scan                             | —             |
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.assets.fy_verification import PHYSICAL_VERIFICATION_AUDIT_ACTION
from modules.assets.model import (
    AssetAuditEvent,
    AssetInventoryInformation,
    AssetMaster,
)
from modules.platform.settings.financial_year import (
    financial_year_period_for,
    financial_year_period_for_start_year,
    is_verified_in_period,
)

SEED_ORDER_PREFIX = "PVO-FY-DEMO"
SEED_SOURCE = "seed_fy_verification_demo"
SEED_ASSET_CODES = (
    "DEMO-AST-001",
    "DEMO-AST-002",
    "DEMO-AST-004",
    "DEMO-AST-006",
    "DEMO-AST-007",
    "DEMO-AST-012",
    "DEMO-AST-010",
)


def _build_specs(
    current_period,
    prev_period,
    today: date,
) -> list[tuple[str, list[tuple[date, str]]]]:
    cs = current_period.start
    ce = current_period.end
    ps = prev_period.start
    pe = prev_period.end

    early_current = min(max(cs + timedelta(days=21), cs), ce)
    mid_current = min(max(cs + timedelta(days=90), cs), ce)
    recent_current = min(max(today, cs), ce)
    prev_mid = min(max(ps + timedelta(days=120), ps), pe)
    prev_late = min(max(pe - timedelta(days=45), ps), pe)

    return [
        ("DEMO-AST-001", [(early_current, "001-A"), (recent_current, "001-B")]),
        ("DEMO-AST-002", [(mid_current, "002")]),
        ("DEMO-AST-004", [(prev_mid, "004-PREV")]),
        (
            "DEMO-AST-006",
            [(early_current, "006-A"), (mid_current, "006-B"), (recent_current, "006-C")],
        ),
        ("DEMO-AST-007", [(prev_mid, "007-A"), (prev_late, "007-B")]),
        ("DEMO-AST-012", [(prev_late, "012-PREV"), (mid_current, "012-CURR")]),
        ("DEMO-AST-010", [(recent_current, "010")]),
    ]


def _asset_id(db: Session, code: str) -> int:
    aid = db.scalar(
        select(AssetMaster.id).where(
            AssetMaster.asset_code == code.upper(),
            AssetMaster.deleted_at.is_(None),
        )
    )
    if aid is None:
        raise RuntimeError(f"Asset {code!r} not found — run scripts/seed_dummy_data.py first.")
    return int(aid)


def _ensure_rfid(db: Session, asset_id: int, code: str) -> None:
    asset = db.get(AssetMaster, asset_id)
    if asset is None:
        return
    if not (asset.rfid_code or "").strip():
        n = int(code.rsplit("-", 1)[-1])
        asset.rfid_code = f"RFID-DEMO-{n:03d}"
        print(f"  patched RFID on {code}")


def _is_seed_event(row: AssetAuditEvent) -> bool:
    if row.action != PHYSICAL_VERIFICATION_AUDIT_ACTION:
        return False
    nv = row.new_value if isinstance(row.new_value, dict) else {}
    if nv.get("source") == SEED_SOURCE:
        return True
    return str(nv.get("order_number", "")).startswith(SEED_ORDER_PREFIX)


def _delete_seed_verifications(db: Session) -> int:
    rows = list(db.scalars(select(AssetAuditEvent).where(AssetAuditEvent.action == PHYSICAL_VERIFICATION_AUDIT_ACTION)).all())
    rows = [r for r in rows if _is_seed_event(r)]
    for row in rows:
        db.delete(row)
    db.flush()
    for code in SEED_ASSET_CODES:
        try:
            aid = _asset_id(db, code)
        except RuntimeError:
            continue
        inv = db.scalar(select(AssetInventoryInformation).where(AssetInventoryInformation.asset_id == aid))
        if inv:
            inv.physical_count = 0
            inv.last_verification_date = None
            inv.verification_status = None
    return len(rows)


def _dt_on(day: date, hour: int = 10, minute: int = 30) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=timezone.utc)


def _add_verification_event(
    db: Session,
    *,
    asset_id: int,
    asset_code: str,
    verify_date: date,
    order_suffix: str,
    previous_verified: date | None,
) -> None:
    order_number = f"{SEED_ORDER_PREFIX}-{order_suffix}"
    db.add(
        AssetAuditEvent(
            asset_id=asset_id,
            actor_user_id=None,
            action=PHYSICAL_VERIFICATION_AUDIT_ACTION,
            section="inventory",
            old_value={
                "physical_count": 0 if previous_verified is None else 1,
                "last_verification_date": previous_verified.isoformat() if previous_verified else None,
            },
            new_value={
                "order_id": 0,
                "order_number": order_number,
                "physical_count": 1,
                "last_verification_date": verify_date.isoformat(),
                "source": SEED_SOURCE,
            },
            created_at=_dt_on(verify_date),
        )
    )


def _apply_inventory_from_events(
    db: Session,
    asset_id: int,
    events: list[tuple[date, str]],
    current_period,
) -> None:
    inv = db.scalar(select(AssetInventoryInformation).where(AssetInventoryInformation.asset_id == asset_id))
    if inv is None:
        inv = AssetInventoryInformation(asset_id=asset_id, inventory_count=1)
        db.add(inv)
    if not events:
        inv.physical_count = 0
        inv.last_verification_date = None
        return
    latest = max(d for d, _ in events)
    inv.physical_count = 1
    inv.last_verification_date = latest
    inv.verification_status = "verified" if is_verified_in_period(latest, current_period) else None


def seed_fy_verification_demo(db: Session, *, reset: bool = False) -> None:
    current_period = financial_year_period_for()
    prev_period = financial_year_period_for_start_year(current_period.start.year - 1)
    today = date.today()
    specs = _build_specs(current_period, prev_period, today)

    if reset:
        removed = _delete_seed_verifications(db)
        db.commit()
        print(f"Removed {removed} seed verification event(s).")

    print(f"Running FY: {current_period.label} ({current_period.start} – {current_period.end})")
    print(f"Previous FY: {prev_period.label} ({prev_period.start} – {prev_period.end})")
    print()

    for asset_code, event_specs in specs:
        asset_id = _asset_id(db, asset_code)
        _ensure_rfid(db, asset_id, asset_code)

        # Skip if seed events already exist for this asset
        prior = list(
            db.scalars(
                select(AssetAuditEvent).where(
                    AssetAuditEvent.asset_id == asset_id,
                    AssetAuditEvent.action == PHYSICAL_VERIFICATION_AUDIT_ACTION,
                )
            ).all()
        )
        if not reset and any(_is_seed_event(r) for r in prior):
            print(f"  skip {asset_code}: seed verifications already present (use --reset)")
            continue

        previous: date | None = None
        sorted_events = sorted(event_specs, key=lambda x: x[0])
        for verify_date, suffix in sorted_events:
            _add_verification_event(
                db,
                asset_id=asset_id,
                asset_code=asset_code,
                verify_date=verify_date,
                order_suffix=suffix,
                previous_verified=previous,
            )
            previous = verify_date

        _apply_inventory_from_events(db, asset_id, sorted_events, current_period)

        current_scans = sum(1 for d, _ in sorted_events if current_period.start <= d <= current_period.end)
        prev_scans = sum(1 for d, _ in sorted_events if prev_period.start <= d <= prev_period.end)
        status = "tagged" if is_verified_in_period(previous, current_period) else "pending"
        print(
            f"  {asset_code}: {len(sorted_events)} total scan(s) — "
            f"{current_scans} this FY, {prev_scans} prior FY — {status}"
        )

    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed FY physical verification dummy data.")
    parser.add_argument("--reset", action="store_true", help="Remove and recreate seed verification events.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        seed_fy_verification_demo(db, reset=args.reset)
        print("\nDone. Open Assets → Financial year tagging to review scan counts.")
        return 0
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
