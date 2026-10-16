"""Sync MODULE_CONFIG into ``features`` / ``permissions`` rows (action-level, dotted codes)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.permissions import invalidate_permission_cache
from modules.platform.features.model import Feature
from modules.module_config import MODULE_CONFIG, _normalize_action_token
from modules.platform.permissions.model import Permission
from modules.platform.roles.model import Role
from modules.rbac_constants import build_permission_code, feature_storage_key


def _backfill_mobile_bulk_verify_grants(db: Session) -> int:
    """Grant bulk verification to roles that already have mobile order scan."""
    by_code = {p.code: p for p in db.scalars(select(Permission)).all() if p.code}
    bulk = by_code.get("mobile.order.bulk_verify")
    if bulk is None:
        return 0
    added = 0
    roles = db.scalars(select(Role).options(selectinload(Role.permissions))).all()
    for role in roles:
        have = {p.code for p in role.permissions if p.code}
        if "mobile.order.scan" not in have and "mobile.order:scan" not in have:
            continue
        if "mobile.order.bulk_verify" in have:
            continue
        role.permissions.append(bulk)
        added += 1
    return added


def _backfill_dashboard_section_grants(db: Session, new_codes: set[str]) -> int:
    """
    When the catalog gains a dashboard tile permission, grant it to roles that already had
    the related access, so existing roles keep seeing the same dashboard.
    Only codes created in this sync run are granted; later admin removals must stick.
    """
    if not new_codes:
        return 0
    pairs = [
        ("order.view", ("dashboard.view", "dashboard.orders.view")),
        (
            "asset.view",
            ("dashboard.view", "dashboard.assets.view", "dashboard.financial_year.view"),
        ),
        ("users.view", ("dashboard.view", "dashboard.it.view")),
        ("transfer.view", ("dashboard.view", "dashboard.transfers.view")),
        ("disposal.view", ("dashboard.view", "dashboard.disposals.view")),
        # Summary strip tiles were split out of their big card.
        ("dashboard.orders.view", ("dashboard.summary_orders.view",)),
        ("dashboard.transfers.view", ("dashboard.summary_transfers.view",)),
        ("dashboard.disposals.view", ("dashboard.summary_disposals.view",)),
        ("dashboard.assets.view", ("dashboard.summary_assets.view",)),
        ("dashboard.it.view", ("dashboard.summary_users.view",)),
    ]
    by_code = {p.code: p for p in db.scalars(select(Permission)).all() if p.code}
    added = 0
    roles = db.scalars(select(Role).options(selectinload(Role.permissions))).all()
    for role in roles:
        have = {p.code for p in role.permissions if p.code}
        for trigger, grant_codes in pairs:
            if trigger not in have and trigger.replace(".", ":", 1) not in have:
                continue
            for code in grant_codes:
                if code in have or code not in new_codes:
                    continue
                perm = by_code.get(code)
                if perm is None:
                    continue
                role.permissions.append(perm)
                have.add(code)
                added += 1
    return added


def sync_all_modules_to_db(db: Session) -> dict[str, int]:
    """
    Upsert features and permissions from MODULE_CONFIG.

    - ``Feature.key`` uses underscores (``users`` or ``users_invites``), never dots.
    - ``Permission.code`` uses dotted form (``users.view`` or ``users.invites.view``).
    - Existing rows matched by ``(feature_id, action)`` get ``code`` updated to the canonical
      dotted value so role assignments stay intact.
    """
    created_features = 0
    updated_codes = 0
    created_permissions = 0
    new_codes: set[str] = set()

    for mod in MODULE_CONFIG:
        module_key = mod["key"].strip().lower()
        for tab in mod["tabs"]:
            tab_key = tab["key"].strip().lower()
            fkey = feature_storage_key(module_key, tab_key)
            title = (tab.get("title") or mod["title"]).strip()

            feature = db.scalar(select(Feature).where(Feature.key == fkey))
            if feature is None:
                feature = Feature(key=fkey, name=title, description=None)
                db.add(feature)
                db.flush()
                created_features += 1
            elif feature.name != title:
                feature.name = title

            for raw_action in tab["actions"]:
                action = _normalize_action_token(raw_action)
                code = build_permission_code(module_key, tab_key, action)

                perm = db.scalar(
                    select(Permission).where(
                        Permission.feature_id == feature.id,
                        Permission.action == action,
                    )
                )
                if perm is None:
                    taken = db.scalar(select(Permission.id).where(Permission.code == code))
                    if taken is not None:
                        # Avoid unique collisions (legacy duplicate); skip creating second row.
                        continue
                    db.add(
                        Permission(
                            feature_id=feature.id,
                            action=action,
                            code=code,
                            description=(
                                "Bulk-verify order assets from a single RFID scan on mobile"
                                if code == "mobile.order.bulk_verify"
                                else None
                            ),
                        )
                    )
                    created_permissions += 1
                    new_codes.add(code)
                else:
                    if perm.code != code:
                        conflict = db.scalar(
                            select(Permission.id).where(Permission.code == code, Permission.id != perm.id)
                        )
                        if conflict is None:
                            perm.code = code
                            updated_codes += 1
                    if code == "mobile.order.bulk_verify" and not (perm.description or "").strip():
                        perm.description = "Bulk-verify order assets from a single RFID scan on mobile"

    db.flush()
    dashboard_grants_added = _backfill_dashboard_section_grants(db, new_codes)
    bulk_verify_grants_added = _backfill_mobile_bulk_verify_grants(db)
    db.commit()
    invalidate_permission_cache(None)
    return {
        "features_created": created_features,
        "permissions_created": created_permissions,
        "permission_codes_updated": updated_codes,
        "dashboard_grants_added": dashboard_grants_added,
        "bulk_verify_grants_added": bulk_verify_grants_added,
    }
