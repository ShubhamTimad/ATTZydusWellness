#!/usr/bin/env python3
"""Create the first superuser when the database has none (idempotent).

Reads ``BOOTSTRAP_SUPERUSER_EMAIL`` and ``BOOTSTRAP_SUPERUSER_PASSWORD`` from the
environment. Skips quietly when any superuser already exists.

Inside Docker::

    python /app/scripts/ensure_bootstrap_superuser.py
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

import db.models  # noqa: F401
from core.password_policy import PasswordPolicyError, validate_password
from core.security import hash_password
from db.session import SessionLocal
from modules.platform.users.model import User


def ensure_bootstrap_superuser() -> None:
    email = (os.environ.get("BOOTSTRAP_SUPERUSER_EMAIL") or "").strip().lower()
    password = os.environ.get("BOOTSTRAP_SUPERUSER_PASSWORD") or ""
    full_name = (os.environ.get("BOOTSTRAP_SUPERUSER_FULL_NAME") or "").strip()

    db = SessionLocal()
    try:
        existing_super = db.scalar(select(User.id).where(User.is_superuser.is_(True)).limit(1))
        if existing_super is not None:
            print("Bootstrap superuser: already exists — skipping.")
            return

        if not email or not password.strip():
            print(
                "Bootstrap superuser: none in database and BOOTSTRAP_SUPERUSER_EMAIL/"
                "BOOTSTRAP_SUPERUSER_PASSWORD not set — skipping.",
            )
            return

        try:
            validate_password(password)
        except PasswordPolicyError as exc:
            print(f"Bootstrap superuser: password policy error — {exc.error}", file=sys.stderr)
            return

        now = datetime.now(timezone.utc)
        display = full_name or email.split("@", 1)[0] or email
        user = User(
            username=email.split("@")[0],
            full_name=display,
            email=email,
            phone=None,
            hashed_password=hash_password(password),
            password_changed_at=now,
            is_superuser=True,
            is_active=True,
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            print(f"Bootstrap superuser: could not create user for {email!r} (constraint).", file=sys.stderr)
            return
        db.refresh(user)
        user.phone = f"+1000000{user.id}"
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            print("Bootstrap superuser: could not assign phone — set BOOTSTRAP_SUPERUSER_PHONE.", file=sys.stderr)
            return
        print(f"Bootstrap superuser: created id={user.id} email={user.email}")
    finally:
        db.close()


def main() -> int:
    ensure_bootstrap_superuser()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
