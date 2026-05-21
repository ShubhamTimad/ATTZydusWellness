#!/usr/bin/env python3
"""Seed dummy roles, plant, email templates, and approval workflows.

Run from the project root::

    ./venv/bin/python scripts/seed_dummy_data.py

Optional: ``./venv/bin/python scripts/seed_manual_test_users.py`` for login test users.

New-user email includes a single temporary password field (``{{temp_password}}``).
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.assets.audit_log import log_asset_event
from modules.assets.model import (
    AssetAuditEvent,
    AssetCategory,
    AssetFinancialInformation,
    AssetInformation,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.approvals.assignment_service import WorkflowMappingService
from modules.approvals.model import ApprovalStep, ApprovalWorkflow, ApprovalWorkflowMapping
from modules.approvals.service import ApprovalWorkflowService
from modules.emails.model import EmailTemplate, EmailTemplateMapping
from modules.errors import ConflictError
from modules.org_units.model import OrgUnit
from modules.permissions.model import Permission
from modules.rbac_sync import sync_all_modules_to_db
from modules.roles.model import Role

# --- Email templates (one password in welcome mail only) ---

EMAIL_TEMPLATES: list[dict[str, str]] = [
    {
        "name": "Welcome — new user",
        "event_code": "USER_CREATED",
        "subject": "Welcome to {{company_name}}",
        "body_html": """
<p>Hello {{user_name}},</p>
<p>Your account is ready. Sign in with:</p>
<ul>
  <li><strong>Email:</strong> {{email}}</li>
  <li><strong>Temporary password:</strong> {{temp_password}}</li>
</ul>
<p>Change your password after your first login.</p>
<p>— {{company_name}}</p>
""".strip(),
    },
    {
        "name": "Forgot password",
        "event_code": "FORGOT_PASSWORD",
        "subject": "Reset your {{company_name}} password",
        "body_html": """
<p>Hello {{user_name}},</p>
<p>We received a request to reset your password.</p>
<p><a href="{{reset_link}}">Reset your password</a></p>
<p>If you did not request this, ignore this email. Your password will not change.</p>
""".strip(),
    },
    {
        "name": "Password changed",
        "event_code": "PASSWORD_RESET",
        "subject": "Your password was updated",
        "body_html": """
<p>Hello {{user_name}},</p>
<p>Your {{company_name}} password was changed successfully.</p>
<p>If you did not make this change, contact your administrator immediately.</p>
""".strip(),
    },
]

# --- Roles and permission codes ---

ROLE_SPECS: list[dict[str, object]] = [
    {
        "name": "Plant Manager",
        "description": "Manage users and approve tasks at assigned plants.",
        "permissions": [
            "users.view",
            "users.create",
            "users.update",
            "approval.view",
            "approval.act",
            "task.view",
            "task.act",
            "asset.view",
            "asset.create",
            "asset.update",
            "asset.import",
            "asset.manage",
        ],
    },
    {
        "name": "Approver",
        "description": "Review and approve pending requests.",
        "permissions": [
            "approval.view",
            "approval.act",
            "task.view",
            "task.act",
            "asset.view",
            "asset.approve",
        ],
    },
    {
        "name": "Operator",
        "description": "Day-to-day workspace access.",
        "permissions": [
            "task.view",
            "task.act",
            "asset.view",
            "asset.create",
            "asset.import",
        ],
    },
    {
        "name": "HR Admin",
        "description": "Create and maintain user accounts.",
        "permissions": [
            "users.view",
            "users.create",
            "users.update",
        ],
    },
]

DEMO_PLANT = {"code": "DEMO-01", "name": "Demo Plant A", "type": "PLANT"}

# Each step: (level, role name, required approvals)
WORKFLOW_SPECS: list[dict[str, object]] = [
    {
        "name": "User creation — HR then Approver",
        "entity_type": "user_creation",
        "activate": True,
        "map_action": "users.create",
        "steps": [
            (1, "HR Admin", 1),
            (2, "Approver", 1),
        ],
    },
    {
        "name": "User creation — Plant Manager only",
        "entity_type": "user_creation",
        "activate": False,
        "map_action": None,
        "steps": [(1, "Plant Manager", 1)],
    },
    {
        "name": "User creation — two-level approval",
        "entity_type": "user_creation",
        "activate": False,
        "map_action": None,
        "steps": [
            (1, "Approver", 1),
            (2, "Plant Manager", 1),
        ],
    },
    {
        "name": "Asset creation — Approver",
        "entity_type": "asset_creation",
        "activate": True,
        "map_action": "asset.create",
        "steps": [(1, "Approver", 1)],
    },
    {
        "name": "Asset import — Plant Manager",
        "entity_type": "asset_import",
        "activate": True,
        "map_action": "asset.import",
        "steps": [(1, "Plant Manager", 1)],
    },
]

# Demo assets (active, no pending approval) for workspace list/detail testing.
DEMO_ASSET_SPECS: list[dict[str, object]] = [
    {
        "asset_code": "DEMO-AST-001",
        "asset_name": "Tablet Press Line A",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-001",
        "serial_no": "TP-2024-001",
        "functional_location": "PROD/BLD-A/LINE-01",
        "actual_location": "Building A, Floor 2",
        "building": "A",
        "floor": "2",
        "room": "201",
        "zone": "Production",
        "cost_center": "CC-4100",
        "inventory_count": 1,
        "physical_count": 1,
        "verification_status": "verified",
    },
    {
        "asset_code": "DEMO-AST-002",
        "asset_name": "HPLC System #3",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-002",
        "serial_no": "HPLC-8832",
        "functional_location": "QC/LAB-02",
        "actual_location": "QC Lab, Bench 3",
        "building": "B",
        "floor": "1",
        "room": "QC-12",
        "zone": "Quality",
        "cost_center": "CC-4200",
        "inventory_count": 1,
        "physical_count": 1,
        "verification_status": "verified",
    },
    {
        "asset_code": "DEMO-AST-003",
        "asset_name": "Laptop — Engineering",
        "category_code": "IT",
        "rfid_code": None,
        "serial_no": "DL-99201",
        "functional_location": "IT/ENG",
        "actual_location": "Office Wing C",
        "building": "C",
        "floor": "3",
        "room": "305",
        "zone": "Office",
        "cost_center": "CC-5100",
        "inventory_count": 1,
        "physical_count": 0,
        "verification_status": "mismatch",
    },
    {
        "asset_code": "DEMO-AST-004",
        "asset_name": "Forklift — Warehouse",
        "category_code": "VEHICLE",
        "rfid_code": "RFID-DEMO-004",
        "serial_no": "FL-7781",
        "functional_location": "WH/DOCK-01",
        "actual_location": "Warehouse Dock 1",
        "building": "WH",
        "floor": "G",
        "room": None,
        "zone": "Logistics",
        "cost_center": "CC-4300",
        "inventory_count": 1,
        "physical_count": 1,
        "verification_status": "verified",
    },
    {
        "asset_code": "DEMO-AST-005",
        "asset_name": "HVAC Unit — Clean Room",
        "category_code": "FACILITY",
        "rfid_code": None,
        "serial_no": "HVAC-CR-09",
        "functional_location": "FAC/CR-HVAC",
        "actual_location": "Clean Room Roof Plant",
        "building": "A",
        "floor": "R",
        "room": None,
        "zone": "Utilities",
        "cost_center": "CC-4400",
        "inventory_count": 1,
        "physical_count": 1,
        "verification_status": "pending",
    },
]


def _permission_ids(db: Session, codes: list[str]) -> list[int]:
    ids: list[int] = []
    missing: list[str] = []
    for code in codes:
        pid = db.scalar(select(Permission.id).where(Permission.code == code))
        if pid is None:
            missing.append(code)
        else:
            ids.append(int(pid))
    if missing:
        raise RuntimeError(f"Missing permissions (run sync_modules first): {', '.join(missing)}")
    return ids


def _upsert_plant(db: Session) -> OrgUnit:
    row = db.scalar(
        select(OrgUnit).where(OrgUnit.type == "PLANT", OrgUnit.code == DEMO_PLANT["code"])
    )
    if row is not None:
        return row
    row = OrgUnit(
        name=str(DEMO_PLANT["name"]),
        code=str(DEMO_PLANT["code"]),
        type=str(DEMO_PLANT["type"]),
        parent_id=None,
    )
    db.add(row)
    db.flush()
    return row


def _upsert_role(
    db: Session,
    *,
    name: str,
    description: str | None,
    permission_ids: list[int],
) -> tuple[Role, bool]:
    existing = db.scalar(select(Role).where(Role.name == name))
    perms = list(db.scalars(select(Permission).where(Permission.id.in_(permission_ids))).all())
    if existing is not None:
        existing.description = description
        existing.permissions = perms
        return existing, False
    role = Role(name=name, description=description)
    role.permissions = perms
    db.add(role)
    db.flush()
    return role, True


def _upsert_email_template(
    db: Session,
    *,
    name: str,
    event_code: str,
    subject: str,
    body_html: str,
) -> tuple[EmailTemplate, bool]:
    created = False
    tpl = db.scalar(select(EmailTemplate).where(EmailTemplate.name == name))
    if tpl is None:
        tpl = EmailTemplate(
            name=name,
            event_code=event_code,
            subject=subject,
            body_html=body_html,
            body_text=None,
            is_active=True,
        )
        db.add(tpl)
        db.flush()
        created = True
    else:
        tpl.event_code = event_code
        tpl.subject = subject
        tpl.body_html = body_html
        tpl.is_active = True

    mapping = db.scalar(
        select(EmailTemplateMapping).where(EmailTemplateMapping.event_code == event_code)
    )
    if mapping is None:
        db.add(
            EmailTemplateMapping(
                event_code=event_code,
                template_id=int(tpl.id),
                is_enabled=True,
            )
        )
    else:
        mapping.template_id = int(tpl.id)
        mapping.is_enabled = True

    return tpl, created


def _role_id(db: Session, name: str) -> int:
    rid = db.scalar(select(Role.id).where(Role.name == name))
    if rid is None:
        raise RuntimeError(f"Role not found: {name!r}. Run seed roles first.")
    return int(rid)


def _seed_workflow(
    db: Session,
    *,
    name: str,
    entity_type: str,
    steps: list[tuple[int, str, int]],
    activate: bool,
    map_action: str | None,
) -> ApprovalWorkflow:
    wf_svc = ApprovalWorkflowService(db)
    map_svc = WorkflowMappingService(db)

    wf = db.scalar(select(ApprovalWorkflow).where(ApprovalWorkflow.name == name))
    if wf is None:
        wf = ApprovalWorkflow(
            name=name.strip(),
            entity_type=entity_type.strip(),
            is_active=False,
            created_by=None,
        )
        db.add(wf)
        db.flush()
    else:
        wf.name = name.strip()
        wf.entity_type = entity_type.strip()
        if wf.is_active:
            wf.is_active = False

    db.execute(delete(ApprovalStep).where(ApprovalStep.workflow_id == int(wf.id)))
    db.flush()

    for step_order, role_name, required in steps:
        db.add(
            ApprovalStep(
                workflow_id=int(wf.id),
                step_order=int(step_order),
                approver_role_id=_role_id(db, str(role_name)),
                required_approvals=int(required),
            )
        )
    db.commit()

    wf = wf_svc.get_workflow(int(wf.id))
    if not wf.steps:
        raise RuntimeError(f"Workflow {name!r} has no steps after seed.")

    if activate and not wf.is_active:
        wf = wf_svc.activate_workflow(int(wf.id), actor_user_id=None)
        db.commit()

    if map_action:
        map_svc.create_mapping(action_code=map_action, workflow_id=int(wf.id))

    return wf_svc.get_workflow(int(wf.id))


def _category_id(db: Session, code: str) -> int | None:
    return db.scalar(select(AssetCategory.id).where(AssetCategory.code == code))


def _seed_demo_assets(db: Session, *, plant_id: int) -> None:
    today = date.today()
    for spec in DEMO_ASSET_SPECS:
        code = str(spec["asset_code"]).upper()
        existing = db.scalar(
            select(AssetMaster.id).where(
                AssetMaster.asset_code == code,
                AssetMaster.deleted_at.is_(None),
            )
        )
        if existing is not None:
            has_audit = db.scalar(
                select(AssetAuditEvent.id).where(AssetAuditEvent.asset_id == existing).limit(1)
            )
            if has_audit is None:
                log_asset_event(
                    db,
                    asset_id=int(existing),
                    actor_user_id=None,
                    action="created",
                    section="master",
                    new_value={"asset_code": code, "source": "seed"},
                )
                print(f"  audit: {code} (backfilled)")
            else:
                print(f"  skip: {code} (already exists)")
            continue

        cat_id = _category_id(db, str(spec["category_code"]))
        asset = AssetMaster(
            asset_name=str(spec["asset_name"]),
            asset_code=code,
            rfid_code=str(spec["rfid_code"]) if spec.get("rfid_code") else None,
            serial_no=str(spec["serial_no"]) if spec.get("serial_no") else None,
            asset_category_id=int(cat_id) if cat_id else None,
            lifecycle_status="active",
            approval_status="approved",
            ownership_type="owned",
            source_type="manual",
            created_by=None,
            approved_by=None,
        )
        db.add(asset)
        db.flush()

        db.add(
            AssetInformation(
                asset_id=asset.id,
                inventory_no=f"INV-{code}",
                asset_description=f"Demo asset — {spec['asset_name']}",
                engineering_description="Seeded for UI testing.",
            )
        )
        db.add(
            AssetLocationInformation(
                asset_id=asset.id,
                plant_id=plant_id,
                functional_location=str(spec["functional_location"]),
                actual_location=str(spec["actual_location"]),
                building=str(spec["building"]) if spec.get("building") else None,
                floor=str(spec["floor"]) if spec.get("floor") else None,
                room=str(spec["room"]) if spec.get("room") else None,
                zone=str(spec["zone"]) if spec.get("zone") else None,
            )
        )
        db.add(
            AssetFinancialInformation(
                asset_id=asset.id,
                cost_center=str(spec["cost_center"]),
                profit_center="PC-100",
                cap_date=today,
                gross_block=Decimal("125000.00"),
                vendor_name="Takeda Demo Vendor",
                po_number=f"PO-{code}",
                currency="USD",
            )
        )
        inv = int(spec["inventory_count"])
        phys = int(spec["physical_count"])
        db.add(
            AssetInventoryInformation(
                asset_id=asset.id,
                inventory_count=inv,
                physical_count=phys,
                last_verification_date=today,
                verification_status=str(spec["verification_status"]),
                verification_remarks=None
                if inv == phys
                else "Physical count differs from inventory record.",
            )
        )
        log_asset_event(
            db,
            asset_id=asset.id,
            actor_user_id=None,
            action="created",
            section="master",
            new_value={"asset_code": code, "source": "seed"},
        )
        print(f"  created: {code} — {spec['asset_name']}")


def main() -> int:
    db = SessionLocal()
    try:
        print("Syncing module permissions…")
        sync_result = sync_all_modules_to_db(db)
        db.commit()
        print(sync_result)

        plant = _upsert_plant(db)
        db.commit()
        print(f"plant: id={plant.id} code={plant.code!r} name={plant.name!r}")

        print("\nRoles:")
        for spec in ROLE_SPECS:
            pname = str(spec["name"])
            desc = str(spec["description"]) if spec.get("description") else None
            codes = list(spec["permissions"])  # type: ignore[arg-type]
            try:
                pids = _permission_ids(db, codes)
                role, created = _upsert_role(
                    db, name=pname, description=desc, permission_ids=pids
                )
                db.commit()
                flag = "created" if created else "updated"
                print(f"  {flag}: {role.name} ({len(pids)} permissions)")
            except IntegrityError:
                db.rollback()
                print(f"  error: could not save role {pname!r}", file=sys.stderr)
                return 1
            except RuntimeError as exc:
                print(f"  error: {exc}", file=sys.stderr)
                return 2

        print("\nEmail templates:")
        for spec in EMAIL_TEMPLATES:
            tpl, created = _upsert_email_template(
                db,
                name=spec["name"],
                event_code=spec["event_code"],
                subject=spec["subject"],
                body_html=spec["body_html"],
            )
            db.commit()
            flag = "created" if created else "updated"
            print(f"  {flag}: {tpl.name} → {tpl.event_code}")

        print("\nApproval workflows:")
        for spec in WORKFLOW_SPECS:
            try:
                wf = _seed_workflow(
                    db,
                    name=str(spec["name"]),
                    entity_type=str(spec["entity_type"]),
                    steps=list(spec["steps"]),  # type: ignore[arg-type]
                    activate=bool(spec["activate"]),
                    map_action=str(spec["map_action"]) if spec.get("map_action") else None,
                )
                role_names = {
                    int(r.id): r.name
                    for r in db.scalars(select(Role)).all()
                }
                steps = sorted(wf.steps, key=lambda s: s.step_order)
                levels = " → ".join(
                    f"L{s.step_order}:{role_names.get(int(s.approver_role_id), '?')}"
                    for s in steps
                )
                status = "active" if wf.is_active else "inactive"
                mapped = str(spec["map_action"]) if spec.get("map_action") else "—"
                print(f"  {wf.name} [{status}] id={wf.id} levels={levels or 'none'} map={mapped}")
            except (RuntimeError, ConflictError, IntegrityError) as exc:
                db.rollback()
                print(f"  error: {spec['name']}: {exc}", file=sys.stderr)
                return 3

        print("\nDemo assets:")
        try:
            _seed_demo_assets(db, plant_id=int(plant.id))
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            print(f"  error: {exc}", file=sys.stderr)
            return 4

        print("\nDone.")
        print("Active user-creation workflow is mapped to users.create (new users need approval).")
        print("USER_CREATED email uses one temporary password ({{temp_password}}).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
