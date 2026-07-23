#!/usr/bin/env python3
"""Bulk-seed asset masters so the Masters UI can exercise vertical scroll.

Idempotent: codes use the ``SCROLL-`` prefix and are skipped if already present.

Run from the project root::

    ./venv/bin/python scripts/seed_masters_scroll_demo.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import db.models  # noqa: F401
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.session import SessionLocal
from modules.asset_masters.model import (
    ActualLocationMaster,
    AssetConditionMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.assets.model import AssetCategory
from modules.platform.org_units.model import OrgUnit

PREFIX = "SCROLL-"
N = 40  # rows per flat master; hierarchical uses N functional / cost centers


def _plant(db: Session) -> OrgUnit:
    plant = db.scalar(select(OrgUnit).where(OrgUnit.code == "TAKEDA"))
    if plant is None:
        plant = db.scalar(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc()))
    if plant is None:
        raise RuntimeError("No plant found. Run scripts/seed_dummy_data.py first.")
    return plant


def _exists(db: Session, model, code: str, **extra) -> bool:
    stmt = select(model.id).where(model.code == code)
    for k, v in extra.items():
        stmt = stmt.where(getattr(model, k) == v)
    return db.scalar(stmt) is not None


def seed_categories(db: Session) -> int:
    n = 0
    for i in range(1, N + 1):
        code = f"{PREFIX}CAT-{i:03d}"
        if _exists(db, AssetCategory, code):
            continue
        db.add(
            AssetCategory(
                code=code,
                name=f"Scroll category {i}",
                description=f"Demo category row {i} for Masters scroll testing",
                is_active=True,
            )
        )
        n += 1
    return n


def seed_tag_colors(db: Session) -> int:
    colors = ("#E11D48", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#64748B", "#0EA5E9", "#D946EF")
    n = 0
    for i in range(1, N + 1):
        code = f"{PREFIX}CLR-{i:03d}"
        if _exists(db, TagColorMaster, code):
            continue
        db.add(
            TagColorMaster(
                code=code,
                name=f"Scroll color {i}",
                color_hex=colors[(i - 1) % len(colors)],
                is_active=True,
            )
        )
        n += 1
    return n


def seed_conditions(db: Session) -> int:
    n = 0
    for i in range(1, N + 1):
        code = f"{PREFIX}COND-{i:03d}"
        if _exists(db, AssetConditionMaster, code):
            continue
        db.add(
            AssetConditionMaster(
                code=code,
                name=f"Scroll condition {i}",
                is_active=True,
            )
        )
        n += 1
    return n


def seed_hierarchy(db: Session, plant_id: int) -> dict[str, int]:
    counts = {"functional": 0, "actual": 0, "cost_center": 0, "profit_center": 0}
    fl_rows: list[FunctionalLocationMaster] = []
    for i in range(1, N + 1):
        code = f"{PREFIX}FL-{i:03d}"
        row = db.scalar(
            select(FunctionalLocationMaster).where(
                FunctionalLocationMaster.plant_id == plant_id,
                FunctionalLocationMaster.code == code,
            )
        )
        if row is None:
            row = FunctionalLocationMaster(
                code=code,
                name=f"Scroll functional {i}",
                description=f"Functional location demo {i}",
                plant_id=plant_id,
                is_active=True,
            )
            db.add(row)
            db.flush()
            counts["functional"] += 1
        fl_rows.append(row)

    for fl in fl_rows:
        for j in range(1, 3):
            code = f"{PREFIX}AL-{fl.code.split('-')[-1]}-{j}"
            exists = db.scalar(
                select(ActualLocationMaster.id).where(
                    ActualLocationMaster.functional_location_id == fl.id,
                    ActualLocationMaster.code == code,
                )
            )
            if exists is not None:
                continue
            db.add(
                ActualLocationMaster(
                    code=code,
                    name=f"Scroll actual {code}",
                    description=f"Actual location under {fl.code}",
                    functional_location_id=fl.id,
                    is_active=True,
                )
            )
            counts["actual"] += 1

    cc_rows: list[CostCenterMaster] = []
    for i in range(1, N + 1):
        code = f"{PREFIX}CC-{i:03d}"
        row = db.scalar(
            select(CostCenterMaster).where(
                CostCenterMaster.plant_id == plant_id,
                CostCenterMaster.code == code,
            )
        )
        if row is None:
            row = CostCenterMaster(
                code=code,
                name=f"Scroll cost center {i}",
                description=f"Cost center demo {i}",
                plant_id=plant_id,
                is_active=True,
            )
            db.add(row)
            db.flush()
            counts["cost_center"] += 1
        cc_rows.append(row)

    for cc in cc_rows:
        for j in range(1, 3):
            code = f"{PREFIX}PC-{cc.code.split('-')[-1]}-{j}"
            exists = db.scalar(
                select(ProfitCenterMaster.id).where(
                    ProfitCenterMaster.cost_center_id == cc.id,
                    ProfitCenterMaster.code == code,
                )
            )
            if exists is not None:
                continue
            db.add(
                ProfitCenterMaster(
                    code=code,
                    name=f"Scroll profit center {code}",
                    description=f"Profit center under {cc.code}",
                    cost_center_id=cc.id,
                    is_active=True,
                )
            )
            counts["profit_center"] += 1

    return counts


def main() -> int:
    db = SessionLocal()
    try:
        plant = _plant(db)
        print(f"Using plant {plant.code} (id={plant.id})")
        cat = seed_categories(db)
        clr = seed_tag_colors(db)
        cond = seed_conditions(db)
        hier = seed_hierarchy(db, int(plant.id))
        db.commit()
        print(
            "Created: "
            f"categories={cat}, tag_colors={clr}, conditions={cond}, "
            f"functional={hier['functional']}, actual={hier['actual']}, "
            f"cost_centers={hier['cost_center']}, profit_centers={hier['profit_center']}"
        )
        print(f"Codes are prefixed with {PREFIX!r} (safe to re-run).")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
