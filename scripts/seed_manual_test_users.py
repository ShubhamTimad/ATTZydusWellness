#!/usr/bin/env python3
"""Seed the shared demo user roster (roles + all five cost centers).

Each user is assigned to the plant and to **every** active canonical cost center:
  CC-4100, CC-4200, CC-4300 (Scrapyard), CC-4400, CC-5100

Run from the project root::

    ./venv/bin/python scripts/seed_dummy_data.py
    ./venv/bin/python scripts/seed_disposal_workflows.py   # CFM, MD, Store Person
    ./venv/bin/python scripts/seed_manual_test_users.py

Default password: ``ChangeMe@123`` (override with ``--password``).

Also writes ``scripts/demo_users.md``.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_BACKEND_ROOT = _ROOT / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.asset_masters.model import CostCenterMaster
from modules.platform.org_units.model import OrgUnit
from modules.platform.roles.model import Role
from modules.platform.users.model import User
from modules.rbac_association import user_cost_center, user_org_unit

TAKEDA_PLANT_CODE = "TAKEDA"
DEFAULT_PASSWORD = "ChangeMe@123"
OUT_MD = Path(__file__).resolve().parent / "demo_users.md"

CANONICAL_CC_CODES = ("CC-4100", "CC-4200", "CC-4300", "CC-4400", "CC-5100")

# name, email, username, role names (multi-role allowed)
DEMO_USERS: list[tuple[str, str, str, tuple[str, ...]]] = [
    ("HR Demo", "hr@demo.com", "hr", ("HR Admin",)),
    (
        "Approver Demo",
        "approver@demo.com",
        "approver",
        ("Approver", "Central Finance", "Department HOD"),
    ),
    ("Plant Manager Demo", "plantmgr@demo.com", "plantmgr", ("Plant Manager",)),
    ("Operator Demo", "operator@demo.com", "operator", ("Operator",)),
    (
        "Alex Rivera",
        "rashi.magar@timadit.com",
        "executor1",
        ("Cost Center User", "Engineering", "Physical Order Executor"),
    ),
    ("Sam Okonkwo", "executor2@demo.com", "executor2", ("Physical Order Executor",)),
    ("Priya Sharma", "executor3@demo.com", "executor3", ("Physical Order Executor",)),
    ("Jordan Lee", "executor4@demo.com", "executor4", ("Physical Order Executor",)),
    ("CC1 Cost Center User", "cc1@demo.com", "cc1", ("Cost Center User",)),
    ("CC2 Cost Center User", "cc2@demo.com", "cc2", ("Cost Center User",)),
    ("Cost Center User Demo", "ccuser@demo.com", "ccuser", ("Cost Center User",)),
    ("Department HOD Demo", "hod@demo.com", "hod", ("Department HOD",)),
    ("Engineering Demo", "engineering@demo.com", "engineering", ("Engineering",)),
    ("Central Finance Demo", "cf@demo.com", "cf", ("Central Finance",)),
    ("CFM Demo", "cfm@demo.com", "cfm", ("CFM",)),
    ("MD Demo", "md@demo.com", "md", ("MD",)),
    ("Store Person Demo", "store@demo.com", "store", ("Store Person",)),
]


def _role_by_name(db: Session, name: str) -> Role | None:
    return db.scalar(select(Role).where(Role.name == name))


def _demo_plant(db: Session) -> OrgUnit | None:
    row = db.scalar(
        select(OrgUnit).where(OrgUnit.type == "PLANT", OrgUnit.code == TAKEDA_PLANT_CODE)
    )
    if row is not None:
        return row
    return db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT").order_by(OrgUnit.id.asc())).first()


def _canonical_cost_centers(db: Session, *, plant_id: int) -> list[CostCenterMaster]:
    return list(
        db.scalars(
            select(CostCenterMaster)
            .where(
                CostCenterMaster.plant_id == int(plant_id),
                CostCenterMaster.code.in_(CANONICAL_CC_CODES),
                CostCenterMaster.is_active.is_(True),
            )
            .order_by(CostCenterMaster.code.asc())
        ).all()
    )


def _upsert_user(
    db: Session,
    *,
    email: str,
    username: str,
    phone: str,
    full_name: str,
    password: str,
    roles: list[Role],
    org: OrgUnit,
    cost_center_ids: list[int],
) -> tuple[User, str]:
    now = datetime.now(timezone.utc)
    email_norm = email.strip().lower()
    existing = db.scalar(select(User).where(User.email == email_norm))
    if existing is None:
        existing = db.scalar(select(User).where(User.username == username))

    if existing is not None:
        existing.full_name = full_name
        existing.phone = phone
        existing.username = username
        existing.email = email_norm
        existing.is_active = True
        existing.hashed_password = hash_password(password)
        existing.password_changed_at = now
        existing.roles.clear()
        for role in roles:
            existing.roles.append(role)
        db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == existing.id))
        db.execute(user_org_unit.insert().values(user_id=existing.id, org_unit_id=org.id))
        db.execute(delete(user_cost_center).where(user_cost_center.c.user_id == existing.id))
        for cc_id in cost_center_ids:
            db.execute(
                user_cost_center.insert().values(user_id=existing.id, cost_center_id=int(cc_id))
            )
        return existing, "updated"

    user = User(
        full_name=full_name,
        username=username,
        email=email_norm,
        phone=phone,
        hashed_password=hash_password(password),
        password_changed_at=now,
        is_active=True,
        is_superuser=False,
    )
    for role in roles:
        user.roles.append(role)
    db.add(user)
    db.flush()
    db.execute(user_org_unit.insert().values(user_id=user.id, org_unit_id=org.id))
    for cc_id in cost_center_ids:
        db.execute(user_cost_center.insert().values(user_id=user.id, cost_center_id=int(cc_id)))
    return user, "created"


def _write_md(password: str, cc_labels: list[str]) -> None:
    lines = [
        "# Demo users",
        "",
        f"**Password for all accounts:** `{password}`",
        "",
        "Each user is assigned to the plant and to **all** of these cost centers:",
        "",
    ]
    for label in cc_labels:
        lines.append(f"- {label}")
    lines += [
        "",
        "| Name | Email | Username | Role(s) |",
        "|---|---|---|---|",
    ]
    for full_name, email, username, role_names in DEMO_USERS:
        lines.append(
            f"| {full_name} | `{email}` | `{username}` | {', '.join(role_names)} |"
        )
    lines += [
        "",
        "Regenerate with:",
        "",
        "```bash",
        "./venv/bin/python scripts/seed_manual_test_users.py",
        "```",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed demo users with roles and all canonical cost centers."
    )
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    args = parser.parse_args()

    try:
        validate_password(args.password)
    except PasswordPolicyError as exc:
        print(f"error: password policy: {exc.error}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        org = _demo_plant(db)
        if org is None:
            print(
                "error: no plant found. Run: ./venv/bin/python scripts/seed_dummy_data.py",
                file=sys.stderr,
            )
            return 4

        ccs = _canonical_cost_centers(db, plant_id=int(org.id))
        found = {cc.code for cc in ccs}
        missing = [c for c in CANONICAL_CC_CODES if c not in found]
        if missing:
            print(
                f"error: missing cost centers {missing}. Run scripts/seed_dummy_data.py first.",
                file=sys.stderr,
            )
            return 4
        cc_ids = [int(cc.id) for cc in ccs]
        cc_labels = [
            f"{cc.code}"
            + (" Scrapyard" if bool(getattr(cc, "is_scrapyard", False)) else "")
            + (f" — {cc.name}" if cc.name else "")
            for cc in ccs
        ]

        print(f"Plant: {org.name!r} (id={org.id}, code={org.code!r})")
        print(f"Cost centers: {', '.join(cc.code for cc in ccs)}")
        print(f"Password for all accounts: {args.password!r}")
        print()

        phone_seq = 2000001
        for full_name, email, username, role_names in DEMO_USERS:
            roles: list[Role] = []
            for role_name in role_names:
                role = _role_by_name(db, role_name)
                if role is None:
                    print(
                        f"error: role {role_name!r} not found. "
                        "Run seed_dummy_data.py / seed_disposal_workflows.py first.",
                        file=sys.stderr,
                    )
                    return 3
                roles.append(role)

            phone = f"+1555{phone_seq:07d}"
            phone_seq += 1
            try:
                user, status = _upsert_user(
                    db,
                    email=email,
                    username=username,
                    phone=phone,
                    full_name=full_name,
                    password=args.password,
                    roles=roles,
                    org=org,
                    cost_center_ids=cc_ids,
                )
                db.commit()
                db.refresh(user)
            except IntegrityError as exc:
                db.rollback()
                print(f"error: {email}: {exc}", file=sys.stderr)
                return 5

            print(
                f"{status}: {user.email:<32}  {user.username:<12}  "
                f"{', '.join(role_names)}"
            )

        _write_md(args.password, cc_labels)
        print()
        print(f"Wrote {OUT_MD.relative_to(_ROOT)}")
        print(f"Created/updated {len(DEMO_USERS)} users on {len(cc_ids)} cost centers.")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
