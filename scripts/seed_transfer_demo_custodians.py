#!/usr/bin/env python3
"""Split demo assets between two custodians on different cost centers.

Sets up transfer-friendly demo data:

* ``operator`` → asset custodian for **CC-4100** (Production) assets
* ``cc2`` → asset custodian for **CC-4200** (QC) assets

Also:

* links those users to their cost centers (``user_cost_centers``)
* registers them in **Cost center custodians** master (``cost_center_asset_custodians``)

Run from project root::

    ./venv/bin/python scripts/seed_transfer_demo_custodians.py

Requires demo users (``scripts/seed_manual_test_users.py``) and cost centers
(``scripts/seed_dummy_data.py``).
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.asset_masters.model import CostCenterAssetCustodian, CostCenterMaster
from modules.assets.model import AssetFinancialInformation, AssetMaster
from modules.platform.org_units.model import OrgUnit
from modules.platform.users.model import User
from modules.rbac_association import user_cost_center

TAKEDA_PLANT_CODE = "TAKEDA"

# username → sole cost center they custodiate for transfer demos
CUSTODIAN_BY_CC: dict[str, str] = {
    "CC-4100": "operator",  # Production — Operator Demo
    "CC-4200": "cc2",  # QC — CC2 Transfer User
}


def _plant(db: Session) -> OrgUnit | None:
    row = db.scalar(
        select(OrgUnit).where(OrgUnit.type == "PLANT", OrgUnit.code == TAKEDA_PLANT_CODE)
    )
    if row is not None:
        return row
    return db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id)).first()


def _user(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def _cost_center(db: Session, *, plant_id: int, code: str) -> CostCenterMaster | None:
    return db.scalar(
        select(CostCenterMaster).where(
            CostCenterMaster.plant_id == plant_id,
            CostCenterMaster.code == code,
        )
    )


def _ensure_user_cost_center(db: Session, *, user_id: int, cost_center_id: int) -> None:
    exists = db.scalar(
        select(user_cost_center.c.user_id).where(
            user_cost_center.c.user_id == user_id,
            user_cost_center.c.cost_center_id == cost_center_id,
        )
    )
    if exists is None:
        db.execute(
            user_cost_center.insert().values(user_id=user_id, cost_center_id=cost_center_id)
        )


def _replace_cc_custodians(db: Session, *, cost_center_id: int, user_ids: list[int]) -> None:
    db.execute(
        delete(CostCenterAssetCustodian).where(
            CostCenterAssetCustodian.cost_center_id == cost_center_id
        )
    )
    for uid in user_ids:
        db.add(CostCenterAssetCustodian(cost_center_id=cost_center_id, user_id=uid))


def _clear_other_custodianships(db: Session, *, user_id: int, keep_cost_center: str) -> int:
    """Remove this user as custodian from assets not on keep_cost_center."""
    assets = list(
        db.scalars(
            select(AssetMaster)
            .outerjoin(
                AssetFinancialInformation,
                AssetFinancialInformation.asset_id == AssetMaster.id,
            )
            .where(
                AssetMaster.asset_custodian_id == user_id,
                AssetMaster.deleted_at.is_(None),
            )
            .options(selectinload(AssetMaster.financial))
        ).all()
    )
    cleared = 0
    for asset in assets:
        fin = asset.financial
        cc = (fin.cost_center if fin else None) or ""
        if cc != keep_cost_center:
            asset.asset_custodian_id = None
            cleared += 1
    return cleared


def _assign_assets_for_cc(
    db: Session, *, cost_center_code: str, custodian_id: int
) -> list[str]:
    """Set custodian on every active asset whose financial cost_center matches."""
    assets = list(
        db.scalars(
            select(AssetMaster)
            .join(AssetFinancialInformation, AssetFinancialInformation.asset_id == AssetMaster.id)
            .where(
                AssetFinancialInformation.cost_center == cost_center_code,
                AssetMaster.deleted_at.is_(None),
            )
            .options(selectinload(AssetMaster.financial))
            .order_by(AssetMaster.asset_code.asc())
        ).all()
    )
    codes: list[str] = []
    for asset in assets:
        asset.asset_custodian_id = custodian_id
        codes.append(asset.asset_code or f"id:{asset.id}")
    return codes


def main() -> int:
    db = SessionLocal()
    try:
        plant = _plant(db)
        if plant is None:
            print("error: no plant found. Run scripts/seed_dummy_data.py first.", file=sys.stderr)
            return 2

        resolved: dict[str, tuple[CostCenterMaster, User]] = {}
        for cc_code, username in CUSTODIAN_BY_CC.items():
            cc = _cost_center(db, plant_id=int(plant.id), code=cc_code)
            user = _user(db, username)
            if cc is None:
                print(f"error: cost center {cc_code!r} missing.", file=sys.stderr)
                return 3
            if user is None:
                print(
                    f"error: user {username!r} missing. Run scripts/seed_manual_test_users.py.",
                    file=sys.stderr,
                )
                return 4
            resolved[cc_code] = (cc, user)

        print(f"Plant: {plant.name!r} (id={plant.id})")
        print()

        for cc_code, (cc, user) in resolved.items():
            _ensure_user_cost_center(db, user_id=int(user.id), cost_center_id=int(cc.id))
            _replace_cc_custodians(db, cost_center_id=int(cc.id), user_ids=[int(user.id)])
            codes = _assign_assets_for_cc(
                db, cost_center_code=cc_code, custodian_id=int(user.id)
            )
            cleared = _clear_other_custodianships(
                db, user_id=int(user.id), keep_cost_center=cc_code
            )
            print(
                f"{cc_code} ({cc.name}) → custodian {user.username} ({user.full_name}) "
                f"· {len(codes)} assets"
                + (f" · cleared {cleared} off-CC assignments" if cleared else "")
            )
            for code in codes[:12]:
                print(f"  - {code}")
            if len(codes) > 12:
                print(f"  … +{len(codes) - 12} more")

        # Keep cc2 linked to destination QC only for clean demos (drop extra CC links).
        cc2 = resolved["CC-4200"][1]
        cc4200 = resolved["CC-4200"][0]
        db.execute(delete(user_cost_center).where(user_cost_center.c.user_id == int(cc2.id)))
        db.execute(
            user_cost_center.insert().values(
                user_id=int(cc2.id), cost_center_id=int(cc4200.id)
            )
        )

        operator = resolved["CC-4100"][1]
        cc4100 = resolved["CC-4100"][0]
        db.execute(delete(user_cost_center).where(user_cost_center.c.user_id == int(operator.id)))
        db.execute(
            user_cost_center.insert().values(
                user_id=int(operator.id), cost_center_id=int(cc4100.id)
            )
        )

        db.commit()
        print()
        print("Done. Transfer demo:")
        print("  1. Login as operator@demo.com — create transfer from CC-4100 assets")
        print("  2. Destination CC-4200 → pick custodian cc2")
        print("  3. Login as cc2@demo.com — receive / own QC assets")
        print("Password: ChangeMe@123")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
