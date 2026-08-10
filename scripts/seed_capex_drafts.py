#!/usr/bin/env python3
"""Seed draft capitalization forms for list / UI testing.

Run from the project root (after seed_dummy_data.py)::

    .venv/bin/python scripts/seed_capex_drafts.py
    .venv/bin/python scripts/seed_capex_drafts.py --count 20
    .venv/bin/python scripts/seed_capex_drafts.py --reset   # delete CAP-SEED-* drafts first
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.asset_masters.model import CostCenterMaster
from modules.capex.model import CapitalizationForm, CapitalizationFormAudit
from modules.capex.schema import CapexFormCreateRequest
from modules.capex.service import CapexFormService
from modules.platform.users.model import User

SEED_ASSET_PREFIX = "Seed CapEx Asset "
DEFAULT_COUNT = 18
DEFAULT_ACTOR_EMAIL = "admin@admin.com"

DEPARTMENTS = ("Production", "Engineering", "Quality", "Warehouse", "Utilities")
LOCATIONS = ("Building A", "Building B", "Plant Floor 1", "Warehouse West", "Lab 3")
PARTIES = ("Acme Industrial", "NovaTech Supplies", "Precision Works", "Global Equip Co")


def _user_id(db: Session, email: str) -> int:
    uid = db.scalar(select(User.id).where(User.email == email.strip().lower()))
    if uid is None:
        raise RuntimeError(f"User {email!r} not found.")
    return int(uid)


def _cost_center_ids(db: Session) -> list[int]:
    rows = list(
        db.scalars(
            select(CostCenterMaster.id)
            .where(CostCenterMaster.is_active.is_(True))
            .order_by(CostCenterMaster.id)
            .limit(10)
        ).all()
    )
    return [int(i) for i in rows]


def _reset_seed_drafts(db: Session) -> int:
    """Remove drafts whose asset_name starts with the seed prefix (and their audits)."""
    ids = list(
        db.scalars(
            select(CapitalizationForm.id).where(
                CapitalizationForm.asset_name.startswith(SEED_ASSET_PREFIX),
                CapitalizationForm.status == "draft",
            )
        ).all()
    )
    if not ids:
        return 0
    db.execute(delete(CapitalizationFormAudit).where(CapitalizationFormAudit.form_id.in_(ids)))
    db.execute(delete(CapitalizationForm).where(CapitalizationForm.id.in_(ids)))
    db.commit()
    return len(ids)


def seed_drafts(db: Session, *, count: int, actor_email: str) -> list[str]:
    actor_id = _user_id(db, actor_email)
    cc_ids = _cost_center_ids(db)
    svc = CapexFormService(db)
    created: list[str] = []
    today = date.today()

    for i in range(1, count + 1):
        form = svc.create_form(
            CapexFormCreateRequest(
                asset_name=f"{SEED_ASSET_PREFIX}{i:02d}",
                equipment_tag_no=f"EQ-SEED-{i:03d}",
                asset_specifications=f"Demo specification for seed asset {i}",
                party_name=PARTIES[(i - 1) % len(PARTIES)],
                department=DEPARTMENTS[(i - 1) % len(DEPARTMENTS)],
                installation_location=LOCATIONS[(i - 1) % len(LOCATIONS)],
                department_head="Seed Department Head",
                functioning_comment="Seeded draft for capitalization list testing.",
                installation_date=today - timedelta(days=i),
                auc_code=f"AUC-SEED-{i:03d}",
                useful_life=f"{(i % 5) + 3} years",
                requires_engineering=(i % 3 == 0),
                cost_center_id=cc_ids[(i - 1) % len(cc_ids)] if cc_ids else None,
                submit=False,
            ),
            actor_user_id=actor_id,
        )
        created.append(form.form_number)
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed draft capitalization forms")
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="Number of drafts (15–20)")
    parser.add_argument("--actor-email", default=DEFAULT_ACTOR_EMAIL)
    parser.add_argument("--reset", action="store_true", help="Delete previous seed drafts first")
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count must be >= 1")

    db = SessionLocal()
    try:
        if args.reset:
            n = _reset_seed_drafts(db)
            print(f"Removed {n} previous seed draft(s).")
        numbers = seed_drafts(db, count=args.count, actor_email=args.actor_email)
        print(f"Created {len(numbers)} draft capitalization form(s) as {args.actor_email}:")
        for n in numbers:
            print(f"  {n}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
