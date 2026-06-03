#!/usr/bin/env python3
"""Create demo accounts with distinct roles for manual testing.

Run from the project root::

    ./venv/bin/python scripts/seed_dummy_data.py   # roles + plant (if needed)
    ./venv/bin/python scripts/seed_manual_test_users.py

Default password: ``ChangeMe@123`` (override with ``--password``).

Users are created active immediately (bypasses user-creation approval flow).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.platform.org_units.model import OrgUnit
from modules.rbac_association import user_org_unit
from modules.platform.roles.model import Role
from modules.platform.users.model import User

import db.models  # noqa: F401

TAKEDA_PLANT_CODE = "TAKEDA"
DEFAULT_PASSWORD = "ChangeMe@123"

# email, phone, full_name, role name (from seed_dummy_data.py)
DEMO_USERS: list[tuple[str, str, str, str]] = [
    ("hr@demo.com", "+15552000001", "HR Demo", "HR Admin"),
    ("approver@demo.com", "+15552000002", "Approver Demo", "Approver"),
    ("plantmgr@demo.com", "+15552000003", "Plant Manager Demo", "Plant Manager"),
    ("operator@demo.com", "+15552000004", "Operator Demo", "Operator"),
    # Physical verification order executors (order.view + order.execute)
    ("executor1@demo.com", "+15552000011", "Alex Rivera", "Physical Order Executor"),
    ("executor2@demo.com", "+15552000012", "Sam Okonkwo", "Physical Order Executor"),
    ("executor3@demo.com", "+15552000013", "Priya Sharma", "Physical Order Executor"),
    ("executor4@demo.com", "+15552000014", "Jordan Lee", "Physical Order Executor"),
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


def _upsert_user(
    db: Session,
    *,
    email: str,
    username: str,
    phone: str,
    full_name: str,
    password: str,
    role: Role,
    org: OrgUnit,
) -> tuple[User, str]:
    """Return (user, status) where status is 'created' | 'updated' | 'unchanged'."""
    now = datetime.now(timezone.utc)
    email_norm = email.strip().lower()
    existing = db.scalar(select(User).where(User.email == email_norm))

    if existing is not None:
        changed = False
        if existing.full_name != full_name:
            existing.full_name = full_name
            changed = True
        if existing.phone != phone:
            existing.phone = phone
            changed = True
        if existing.username != username:
            existing.username = username
            changed = True
        if not existing.is_active:
            existing.is_active = True
            changed = True
        existing.hashed_password = hash_password(password)
        existing.password_changed_at = now
        changed = True

        role_ids = {int(r.id) for r in existing.roles}
        if role.id not in role_ids:
            existing.roles.clear()
            existing.roles.append(role)
            changed = True

        db.execute(delete(user_org_unit).where(user_org_unit.c.user_id == existing.id))
        db.execute(user_org_unit.insert().values(user_id=existing.id, org_unit_id=org.id))

        return existing, "updated" if changed else "unchanged"

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
    user.roles.append(role)
    db.add(user)
    db.flush()

    db.execute(user_org_unit.insert().values(user_id=user.id, org_unit_id=org.id))
    return user, "created"


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed demo users (one per role).")
    parser.add_argument(
        "--password",
        default=DEFAULT_PASSWORD,
        help=f"Plain password for all users (default: {DEFAULT_PASSWORD!r}).",
    )
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

        print(f"Plant: {org.name!r} (id={org.id}, code={org.code!r})")
        print(f"Password for all accounts: {args.password!r}")
        print()

        for email, phone, full_name, role_name in DEMO_USERS:
            role = _role_by_name(db, role_name)
            if role is None:
                print(
                    f"error: role {role_name!r} not found. Run scripts/seed_dummy_data.py first.",
                    file=sys.stderr,
                )
                return 3

            username = email.split("@", 1)[0]
            try:
                user, status = _upsert_user(
                    db,
                    email=email,
                    username=username,
                    phone=phone,
                    full_name=full_name,
                    password=args.password,
                    role=role,
                    org=org,
                )
                db.commit()
                db.refresh(user)
            except IntegrityError as exc:
                db.rollback()
                print(f"error: {email}: {exc}", file=sys.stderr)
                return 5

            print(
                f"{status}: id={user.id}  email={user.email}  username={user.username}  "
                f"role={role_name!r}  active={user.is_active}"
            )

        print()
        print("Sign in with email + password.")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
