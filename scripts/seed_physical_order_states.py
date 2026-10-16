#!/usr/bin/env python3
"""Seed physical orders across every lifecycle state for UI / workflow testing.

Run from the project root (after seed_dummy_data.py and seed_manual_test_users.py)::

    ./venv/bin/python scripts/seed_physical_order_states.py
    ./venv/bin/python scripts/seed_physical_order_states.py --reset   # delete & recreate

Orders created (PVO-SEED-*):

| Order           | Status              | Scenario                          |
|-----------------|---------------------|-----------------------------------|
| PVO-SEED-00001  | draft               | Created, not submitted            |
| PVO-SEED-00002  | pending_approval    | Awaiting creation approval        |
| PVO-SEED-00003  | rejected            | Creation approval rejected        |
| PVO-SEED-00004  | assigned            | Approved + assigned, not started  |
| PVO-SEED-00005  | assigned            | Reassigned executor1 → executor2  |
| PVO-SEED-00006  | in_progress         | Started, partial scan             |
| PVO-SEED-00007  | in_progress         | Started, all scanned (ready Complete) |
| PVO-SEED-00008  | pending_closure     | Work done, awaiting closure approval |
| PVO-SEED-00009  | completed           | Work done, awaiting Close         |
| PVO-SEED-00010  | closed              | Final state                       |
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.assets.model import AssetMaster
from modules.orders.audit import log_order_event
from modules.orders.constants import (
    ITEM_STATUS_APPROVED,
    ITEM_STATUS_PENDING,
    ITEM_STATUS_REJECTED,
    ORDER_STATUS_ASSIGNED,
    ORDER_STATUS_CLOSED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_DRAFT,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_REJECTED,
)
from modules.orders.model import PhysicalOrder, PhysicalOrderAudit, PhysicalOrderItem
from modules.platform.org_units.model import OrgUnit
from modules.platform.users.model import User

TAKEDA_PLANT_CODE = "TAKEDA"
SEED_PREFIX = "PVO-SEED-"

# Ensure enough RFID-tagged assets for one order each (no asset overlap).
ASSET_RFID_PATCHES: dict[str, str] = {
    "DEMO-AST-003": "RFID-DEMO-003",
    "DEMO-AST-005": "RFID-DEMO-005",
    "DEMO-AST-008": "RFID-DEMO-008",
    "DEMO-AST-009": "RFID-DEMO-009",
    "DEMO-AST-011": "RFID-DEMO-011",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _user_id(db: Session, email: str) -> int:
    uid = db.scalar(select(User.id).where(User.email == email.strip().lower()))
    if uid is None:
        raise RuntimeError(f"User {email!r} not found — run seed_manual_test_users.py first.")
    return int(uid)


def _plant_id(db: Session) -> int:
    pid = db.scalar(
        select(OrgUnit.id).where(OrgUnit.type == "PLANT", OrgUnit.code == TAKEDA_PLANT_CODE)
    )
    if pid is None:
        pid = db.scalar(select(OrgUnit.id).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc()))
    if pid is None:
        raise RuntimeError("No plant found — run seed_dummy_data.py first.")
    return int(pid)


def _cost_center_id(db: Session, *, plant_id: int, code: str) -> int:
    from modules.asset_masters.model import CostCenterMaster

    cid = db.scalar(
        select(CostCenterMaster.id).where(
            CostCenterMaster.plant_id == plant_id,
            CostCenterMaster.code == code,
        )
    )
    if cid is None:
        raise RuntimeError(f"Cost center {code!r} missing for plant {plant_id}")
    return int(cid)


def _asset_row(db: Session, code: str) -> tuple[int, str]:
    row = db.scalar(
        select(AssetMaster).where(
            AssetMaster.asset_code == code.upper(),
            AssetMaster.deleted_at.is_(None),
        )
    )
    if row is None:
        raise RuntimeError(f"Asset {code!r} not found — run seed_dummy_data.py first.")
    return int(row.id), str(row.asset_code)


def _ensure_asset_rfids(db: Session) -> None:
    for code, rfid in ASSET_RFID_PATCHES.items():
        asset = db.scalar(
            select(AssetMaster).where(
                AssetMaster.asset_code == code,
                AssetMaster.deleted_at.is_(None),
            )
        )
        if asset is None:
            continue
        if not (asset.rfid_code or "").strip():
            asset.rfid_code = rfid
            print(f"  patched RFID on {code} → {rfid}")


def _delete_seed_orders(db: Session) -> int:
    ids = list(
        db.scalars(
            select(PhysicalOrder.id).where(PhysicalOrder.order_number.like(f"{SEED_PREFIX}%"))
        ).all()
    )
    if not ids:
        return 0
    db.execute(delete(PhysicalOrderAudit).where(PhysicalOrderAudit.order_id.in_(ids)))
    db.execute(delete(PhysicalOrderItem).where(PhysicalOrderItem.order_id.in_(ids)))
    db.execute(delete(PhysicalOrder).where(PhysicalOrder.id.in_(ids)))
    return len(ids)


def _add_item(
    db: Session,
    *,
    order_id: int,
    asset_id: int,
    verified: bool = False,
    rejected: bool = False,
    verified_by: int | None = None,
    when: datetime | None = None,
) -> None:
    when = when or _now()
    vstatus = ITEM_STATUS_REJECTED if rejected else (ITEM_STATUS_APPROVED if verified else ITEM_STATUS_PENDING)
    db.add(
        PhysicalOrderItem(
            order_id=order_id,
            asset_id=asset_id,
            verification_status=vstatus,
            rejection_reason="Demo rejection — creation approval" if rejected else None,
            scan_time=when if verified else None,
            verified_by=verified_by if verified else None,
        )
    )


def _seed_order(
    db: Session,
    *,
    order_number: str,
    plant_id: int,
    cost_center_id: int,
    status: str,
    asset_codes: list[str],
    creator_id: int,
    assignee_id: int,
    remarks: str,
    assigned_at: datetime | None = None,
    assigned_by: int | None = None,
    started_at: datetime | None = None,
    started_by: int | None = None,
    completed_at: datetime | None = None,
    closed_at: datetime | None = None,
    verified_asset_codes: list[str] | None = None,
    audit_events: list[tuple[str, dict | None]] | None = None,
) -> PhysicalOrder:
    asset_ids: list[tuple[int, str]] = [_asset_row(db, c) for c in asset_codes]
    verified_set = {c.upper() for c in (verified_asset_codes or [])}

    order = PhysicalOrder(
        order_number=order_number,
        plant_id=plant_id,
        cost_center_id=cost_center_id,
        created_by=creator_id,
        assigned_to=assignee_id,
        assigned_by=assigned_by,
        assigned_at=assigned_at,
        started_by=started_by,
        started_at=started_at,
        completed_at=completed_at,
        closed_at=closed_at,
        status=status,
        remarks=remarks,
    )
    db.add(order)
    db.flush()

    when = _now()
    for aid, code in asset_ids:
        _add_item(
            db,
            order_id=int(order.id),
            asset_id=aid,
            verified=code.upper() in verified_set,
            rejected=False,
            verified_by=started_by if code.upper() in verified_set else None,
            when=when,
        )

    log_order_event(
        db,
        order_id=int(order.id),
        action="order_created",
        actor_user_id=creator_id,
        new_value={"order_number": order_number, "asset_count": len(asset_ids), "seed": True},
    )

    for action, extra in audit_events or []:
        log_order_event(
            db,
            order_id=int(order.id),
            action=action,
            actor_user_id=creator_id,
            new_value=extra,
        )

    return order


def _build_specs(
    *,
    creator_id: int,
    executor1: int,
    executor2: int,
    executor3: int,
    cc4100: int,
    cc4200: int,
    cc4300: int,
    cc4400: int,
    cc5100: int,
) -> list[dict]:
    t0 = _now()
    t1 = t0 - timedelta(hours=2)
    t2 = t0 - timedelta(hours=1)

    return [
        {
            "order_number": f"{SEED_PREFIX}00001",
            "status": ORDER_STATUS_DRAFT,
            "cost_center_id": cc4100,
            "assets": ["DEMO-AST-001"],
            "assignee_id": executor1,
            "remarks": "Draft — created but not submitted for approval",
            "audit_events": [],
        },
        {
            "order_number": f"{SEED_PREFIX}00002",
            "status": ORDER_STATUS_PENDING_APPROVAL,
            "cost_center_id": cc4300,
            "assets": ["DEMO-AST-009"],
            "assignee_id": executor1,
            "remarks": "Pending creation approval",
            "audit_events": [
                ("submitted_for_approval", {"approval_request_id": 90001, "seed": True}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00003",
            "status": ORDER_STATUS_REJECTED,
            "cost_center_id": cc4200,
            "assets": ["DEMO-AST-002"],
            "assignee_id": executor1,
            "remarks": "Rejected at creation approval",
            "audit_events": [
                ("submitted_for_approval", {"approval_request_id": 90002, "seed": True}),
                ("rejected", {"phase": "creation", "reason": "Budget not approved for this quarter"}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00004",
            "status": ORDER_STATUS_ASSIGNED,
            "cost_center_id": cc4200,
            "assets": ["DEMO-AST-007"],
            "assignee_id": executor1,
            "assigned_at": t1,
            "assigned_by": creator_id,
            "remarks": "Approved and assigned — ready to Start",
            "audit_events": [
                ("submitted_for_approval", {"approval_request_id": 90003, "seed": True}),
                ("approved", {"seed": True}),
                ("assignment_changed", {"assigned_to": executor1, "auto_assigned": True}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00005",
            "status": ORDER_STATUS_ASSIGNED,
            "cost_center_id": cc4400,
            "assets": ["DEMO-AST-010"],
            "assignee_id": executor2,
            "assigned_at": t2,
            "assigned_by": creator_id,
            "remarks": "Reassigned from Alex Rivera to Sam Okonkwo before work started",
            "audit_events": [
                ("submitted_for_approval", {"approval_request_id": 90004, "seed": True}),
                ("approved", {"seed": True}),
                (
                    "assignment_changed",
                    {"assigned_to": executor1, "auto_assigned": True},
                ),
                (
                    "assignment_changed",
                    {
                        "assigned_to": executor2,
                        "reassigned": True,
                        "old_assigned_to": executor1,
                    },
                ),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00006",
            "status": ORDER_STATUS_IN_PROGRESS,
            "cost_center_id": cc4100,
            "assets": ["DEMO-AST-006", "DEMO-AST-012"],
            "assignee_id": executor1,
            "assigned_at": t1,
            "assigned_by": creator_id,
            "started_at": t0,
            "started_by": executor1,
            "verified_asset_codes": ["DEMO-AST-012"],
            "remarks": "In progress — 1 of 2 assets scanned",
            "audit_events": [
                ("submitted_for_approval", {"seed": True}),
                ("approved", {"seed": True}),
                ("assignment_changed", {"assigned_to": executor1, "auto_assigned": True}),
                ("started", {}),
                ("asset_verified", {"asset_code": "DEMO-AST-012", "rfid_code": "RFID-DEMO-012"}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00007",
            "status": ORDER_STATUS_IN_PROGRESS,
            "cost_center_id": cc4300,
            "assets": ["DEMO-AST-004"],
            "assignee_id": executor3,
            "assigned_at": t1,
            "assigned_by": creator_id,
            "started_at": t0,
            "started_by": executor3,
            "verified_asset_codes": ["DEMO-AST-004"],
            "remarks": "In progress — all assets scanned, ready to Complete",
            "audit_events": [
                ("submitted_for_approval", {"seed": True}),
                ("approved", {"seed": True}),
                ("assignment_changed", {"assigned_to": executor3, "auto_assigned": True}),
                ("started", {}),
                ("asset_verified", {"asset_code": "DEMO-AST-004", "rfid_code": "RFID-DEMO-004"}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00008",
            "status": ORDER_STATUS_PENDING_CLOSURE,
            "cost_center_id": cc5100,
            "assets": ["DEMO-AST-003"],
            "assignee_id": executor2,
            "assigned_at": t1,
            "assigned_by": creator_id,
            "started_at": t2,
            "started_by": executor2,
            "verified_asset_codes": ["DEMO-AST-003"],
            "remarks": "Work complete — awaiting closure approval",
            "audit_events": [
                ("submitted_for_approval", {"seed": True}),
                ("approved", {"seed": True}),
                ("assignment_changed", {"assigned_to": executor2, "auto_assigned": True}),
                ("started", {}),
                ("asset_verified", {"asset_code": "DEMO-AST-003", "rfid_code": "RFID-DEMO-003"}),
                ("closure_submitted", {"approval_request_id": 90008, "seed": True}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00009",
            "status": ORDER_STATUS_COMPLETED,
            "cost_center_id": cc4200,
            "assets": ["DEMO-AST-008"],
            "assignee_id": executor1,
            "assigned_at": t1,
            "assigned_by": creator_id,
            "started_at": t2,
            "started_by": executor1,
            "completed_at": t0,
            "verified_asset_codes": ["DEMO-AST-008"],
            "remarks": "Completed — use Close button to finish",
            "audit_events": [
                ("submitted_for_approval", {"seed": True}),
                ("approved", {"seed": True}),
                ("assignment_changed", {"assigned_to": executor1, "auto_assigned": True}),
                ("started", {}),
                ("asset_verified", {"asset_code": "DEMO-AST-008", "rfid_code": "RFID-DEMO-008"}),
                ("completed", {"seed": True}),
            ],
        },
        {
            "order_number": f"{SEED_PREFIX}00010",
            "status": ORDER_STATUS_CLOSED,
            "cost_center_id": cc5100,
            "assets": ["DEMO-AST-011"],
            "assignee_id": executor3,
            "assigned_at": t1,
            "assigned_by": creator_id,
            "started_at": t2,
            "started_by": executor3,
            "completed_at": t1,
            "closed_at": t0,
            "verified_asset_codes": ["DEMO-AST-011"],
            "remarks": "Closed — final state",
            "audit_events": [
                ("submitted_for_approval", {"seed": True}),
                ("approved", {"seed": True}),
                ("assignment_changed", {"assigned_to": executor3, "auto_assigned": True}),
                ("started", {}),
                ("asset_verified", {"asset_code": "DEMO-AST-011", "rfid_code": "RFID-DEMO-011"}),
                ("completed", {"seed": True}),
                ("closed", {"seed": True}),
            ],
        },
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed physical orders in every lifecycle state.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help=f"Delete existing {SEED_PREFIX}* orders and recreate them.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        plant_id = _plant_id(db)
        creator_id = _user_id(db, "operator@demo.com")
        executor1 = _user_id(db, "executor1@demo.com")
        executor2 = _user_id(db, "executor2@demo.com")
        executor3 = _user_id(db, "executor3@demo.com")

        cc4100 = _cost_center_id(db, plant_id=plant_id, code="CC-4100")
        cc4200 = _cost_center_id(db, plant_id=plant_id, code="CC-4200")
        cc4300 = _cost_center_id(db, plant_id=plant_id, code="CC-4300")
        cc4400 = _cost_center_id(db, plant_id=plant_id, code="CC-4400")
        cc5100 = _cost_center_id(db, plant_id=plant_id, code="CC-5100")

        print("Ensuring demo assets have RFID tags…")
        _ensure_asset_rfids(db)
        db.commit()

        if args.reset:
            removed = _delete_seed_orders(db)
            db.commit()
            print(f"Removed {removed} existing seed order(s).")
        else:
            existing = db.scalar(
                select(PhysicalOrder.id).where(PhysicalOrder.order_number == f"{SEED_PREFIX}00001")
            )
            if existing is not None:
                print(f"Seed orders already exist. Run with --reset to recreate.")
                return 0

        specs = _build_specs(
            creator_id=creator_id,
            executor1=executor1,
            executor2=executor2,
            executor3=executor3,
            cc4100=cc4100,
            cc4200=cc4200,
            cc4300=cc4300,
            cc4400=cc4400,
            cc5100=cc5100,
        )

        print("\nCreating demo physical orders:")
        for spec in specs:
            order = _seed_order(
                db,
                order_number=str(spec["order_number"]),
                plant_id=plant_id,
                cost_center_id=int(spec["cost_center_id"]),
                status=str(spec["status"]),
                asset_codes=list(spec["assets"]),
                creator_id=creator_id,
                assignee_id=int(spec["assignee_id"]),
                remarks=str(spec["remarks"]),
                assigned_at=spec.get("assigned_at"),
                assigned_by=spec.get("assigned_by"),
                started_at=spec.get("started_at"),
                started_by=spec.get("started_by"),
                completed_at=spec.get("completed_at"),
                closed_at=spec.get("closed_at"),
                verified_asset_codes=list(spec.get("verified_asset_codes") or []),
                audit_events=list(spec.get("audit_events") or []),
            )
            print(f"  {order.order_number} → {order.status} ({spec['remarks'][:50]}…)")

        db.commit()
        print(f"\nDone — {len(specs)} orders seeded.")
        print("Login as operator@demo.com or executor*@demo.com (password: ChangeMe@123)")
        return 0
    except RuntimeError as exc:
        db.rollback()
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        db.rollback()
        print(f"error: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
