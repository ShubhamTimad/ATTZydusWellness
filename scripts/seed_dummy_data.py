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

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
)
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
from modules.platform.approvals.assignment_service import WorkflowMappingService
from modules.platform.approvals.model import ApprovalStep, ApprovalWorkflow, ApprovalWorkflowMapping
from modules.platform.approvals.service import ApprovalWorkflowService
from modules.platform.emails.model import EmailTemplate, EmailTemplateMapping
from modules.errors import ConflictError
from modules.orders.model import PhysicalOrder
from modules.platform.org_units.model import OrgUnit
from modules.rbac_association import user_org_unit
from modules.platform.permissions.model import Permission
from modules.rbac_sync import sync_all_modules_to_db
from modules.platform.roles.model import Role
from modules.orders.audit import log_order_event
from modules.orders.constants import (
    ITEM_STATUS_APPROVED,
    ITEM_STATUS_PENDING,
    ITEM_STATUS_REJECTED,
    ORDER_STATUS_APPROVED,
    ORDER_STATUS_COMPLETED,
    ORDER_STATUS_IN_PROGRESS,
    ORDER_STATUS_PENDING_APPROVAL,
    ORDER_STATUS_PENDING_CLOSURE,
    ORDER_STATUS_REJECTED,
)
from modules.orders.model import PhysicalOrder, PhysicalOrderItem

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
        "description": "Full workspace access including physical order create, execute, approve, and closure.",
        "permissions": "__all__",
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
    {
        "name": "Physical Order Creator",
        "description": "Create physical verification orders.",
        "permissions": ["order.create", "order.view"],
    },
    {
        "name": "Physical Order Executor",
        "description": "Execute physical verification on assigned orders.",
        "permissions": ["order.execute", "order.view"],
    },
    {
        "name": "Physical Order Approver",
        "description": "Approve physical verification orders and closures.",
        "permissions": ["order.approve", "order.view", "approval.view", "approval.act"],
    },
]

TAKEDA_PLANT = {"code": "TAKEDA", "name": "Takeda", "type": "PLANT"}
LEGACY_PLANT_CODES = ("DEMO-01",)

# Reference masters for Takeda plant: functional / actual locations and cost / profit centers.
REFERENCE_MASTER_SPECS: dict[str, object] = {
    "functional_locations": [
        ("PROD/BLD-A/LINE-01", "Production line A — Building A"),
        ("QC/LAB-02", "QC laboratory — Building B"),
        ("IT/ENG", "Engineering & IT — Office wing"),
        ("WH/RECEIVING", "Warehouse receiving & logistics"),
        ("FAC/CR-HVAC", "Clean room HVAC & utilities"),
    ],
    "actual_locations": [
        # (functional_location_code, actual_code, description)
        ("PROD/BLD-A/LINE-01", "BLD-A-F2-R201", "Building A, floor 2, room 201"),
        ("PROD/BLD-A/LINE-01", "BLD-A-F2-R202", "Building A, floor 2, room 202"),
        ("PROD/BLD-A/LINE-01", "BLD-A-F1-BAY1", "Building A, floor 1, bay 1"),
        ("PROD/BLD-A/LINE-01", "LINE-A-BAY2", "Line A — bay 2"),
        ("QC/LAB-02", "QC-BENCH-01", "QC lab bench 1"),
        ("QC/LAB-02", "QC-BENCH-02", "QC lab bench 2"),
        ("QC/LAB-02", "QC-BENCH-03", "QC lab bench 3"),
        ("QC/LAB-02", "QC-SAMPLE-STORE", "QC sample storage"),
        ("IT/ENG", "OFF-WING-C-305", "Office wing C, room 305"),
        ("IT/ENG", "OFF-WING-C-306", "Office wing C, room 306"),
        ("IT/ENG", "OFF-WING-B-210", "Office wing B, room 210"),
        ("IT/ENG", "IT-SERVER-ROOM", "IT server room"),
        ("WH/RECEIVING", "WH-DOCK-01", "Warehouse dock 1"),
        ("WH/RECEIVING", "WH-DOCK-02", "Warehouse dock 2"),
        ("WH/RECEIVING", "WH-STAGING", "Warehouse staging area"),
        ("WH/RECEIVING", "WH-COLD-STORE", "Cold storage"),
        ("FAC/CR-HVAC", "CR-ROOF-PLANT", "Clean room roof plant"),
        ("FAC/CR-HVAC", "CR-MEZZ-09", "Clean room mezzanine 9"),
        ("FAC/CR-HVAC", "UTIL-ROOF-N", "Utilities roof — north"),
        ("FAC/CR-HVAC", "UTIL-ROOF-S", "Utilities roof — south"),
    ],
    "cost_centers": [
        ("CC-4100", "Production cost center"),
        ("CC-4200", "QC & quality cost center"),
        ("CC-4300", "Logistics & warehouse cost center"),
        ("CC-4400", "Utilities & facilities cost center"),
        ("CC-5100", "IT & engineering cost center"),
    ],
    "profit_centers": [
        ("CC-4100", "PC-100", "Corporate profit center"),
        ("CC-4100", "PC-200", "Plant production profit center"),
        ("CC-4200", "PC-300", "QC profit center"),
        ("CC-4300", "PC-400", "Logistics profit center"),
        ("CC-5100", "PC-500", "IT profit center"),
        ("CC-4400", "PC-440", "Utilities profit center"),
    ],
}

# Profit center code per cost center (must exist in REFERENCE_MASTER_SPECS).
_COST_CENTER_TO_PROFIT_CENTER: dict[str, str] = {
    "CC-4100": "PC-200",
    "CC-4200": "PC-300",
    "CC-4300": "PC-400",
    "CC-4400": "PC-440",
    "CC-5100": "PC-500",
}

_CATEGORY_DEMO_META: dict[str, tuple[str, str, str, Decimal, Decimal]] = {
    "EQUIPMENT": ("Production Equipment", "Machinery", "Manufacturing", Decimal("125000.00"), Decimal("10.0000")),
    "IT": ("IT Equipment", "Computer Hardware", "IT Systems", Decimal("3500.00"), Decimal("25.0000")),
    "VEHICLE": ("Fleet Asset", "Material Handling", "Logistics", Decimal("52000.00"), Decimal("15.0000")),
    "FACILITY": ("Facility Asset", "Building Services", "Utilities", Decimal("185000.00"), Decimal("8.0000")),
}

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
    {
        "name": "Physical Order Creation Approval",
        "entity_type": "physical_order_creation",
        "activate": True,
        "map_action": "order.create",
        "steps": [
            (1, "Operator", 1),
            (2, "Operator", 1),
        ],
    },
    {
        "name": "Physical Order Completion Approval",
        "entity_type": "physical_order_closure",
        "activate": True,
        "map_action": "order.complete",
        "steps": [
            (1, "Operator", 1),
            (2, "Operator", 1),
        ],
    },
]

# Demo assets (active, no pending approval) for workspace list/detail testing.
DEMO_ASSET_SPECS: list[dict[str, object]] = [
    {
        "asset_code": "DEMO-AST-001",
        "asset_name": "Tablet Press Line A",
        "asset_class": "Production Equipment",
        "asset_type": "Tablet Press",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-001",
        "serial_no": "TP-2024-001",
        "sub_location": "Line A — Bay 2",
        "functional_location": "PROD/BLD-A/LINE-01",
        "actual_location": "BLD-A-F2-R201",
        "building": "A",
        "floor": "2",
        "room": "201",
        "zone": "Production",
        "cost_center": "CC-4100",
        "party_details": "OEM Supplier GmbH",
        "invoice_no": "INV-2024-1001",
        "voucher_no": "VCH-4100-01",
        "grn_no": "GRN-2024-501",
    },
    {
        "asset_code": "DEMO-AST-002",
        "asset_name": "HPLC System #3",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-002",
        "serial_no": "HPLC-8832",
        "functional_location": "QC/LAB-02",
        "actual_location": "QC-BENCH-03",
        "building": "B",
        "floor": "1",
        "room": "QC-12",
        "zone": "Quality",
        "cost_center": "CC-4200",
    },
    {
        "asset_code": "DEMO-AST-003",
        "asset_name": "Laptop — Engineering",
        "category_code": "IT",
        "serial_no": "DL-99201",
        "functional_location": "IT/ENG",
        "actual_location": "OFF-WING-C-305",
        "building": "C",
        "floor": "3",
        "room": "305",
        "zone": "Office",
        "cost_center": "CC-5100",
    },
    {
        "asset_code": "DEMO-AST-004",
        "asset_name": "Forklift — Warehouse",
        "category_code": "VEHICLE",
        "rfid_code": "RFID-DEMO-004",
        "serial_no": "FL-7781",
        "functional_location": "WH/RECEIVING",
        "actual_location": "WH-DOCK-01",
        "building": "WH",
        "floor": "G",
        "room": "DOCK",
        "zone": "Logistics",
        "cost_center": "CC-4300",
    },
    {
        "asset_code": "DEMO-AST-005",
        "asset_name": "HVAC Unit — Clean Room",
        "category_code": "FACILITY",
        "serial_no": "HVAC-CR-09",
        "functional_location": "FAC/CR-HVAC",
        "actual_location": "CR-ROOF-PLANT",
        "building": "A",
        "floor": "R",
        "room": "ROOF",
        "zone": "Utilities",
        "cost_center": "CC-4400",
    },
    {
        "asset_code": "DEMO-AST-006",
        "asset_name": "Autoclave — Sterile Supply",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-006",
        "serial_no": "AC-6601",
        "functional_location": "PROD/BLD-A/LINE-01",
        "actual_location": "BLD-A-F2-R202",
        "cost_center": "CC-4100",
    },
    {
        "asset_code": "DEMO-AST-007",
        "asset_name": "Balances — QC Weighing",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-007",
        "serial_no": "BAL-2200",
        "functional_location": "QC/LAB-02",
        "actual_location": "QC-BENCH-01",
        "cost_center": "CC-4200",
    },
    {
        "asset_code": "DEMO-AST-008",
        "asset_name": "Monitor — QC Lab",
        "category_code": "IT",
        "serial_no": "MON-8812",
        "functional_location": "QC/LAB-02",
        "actual_location": "QC-BENCH-02",
        "cost_center": "CC-4200",
    },
    {
        "asset_code": "DEMO-AST-009",
        "asset_name": "Pallet Jack — Warehouse",
        "category_code": "VEHICLE",
        "serial_no": "PJ-4410",
        "functional_location": "WH/RECEIVING",
        "actual_location": "WH-STAGING",
        "cost_center": "CC-4300",
    },
    {
        "asset_code": "DEMO-AST-010",
        "asset_name": "Chiller — Utilities",
        "category_code": "FACILITY",
        "rfid_code": "RFID-DEMO-010",
        "serial_no": "CH-9901",
        "functional_location": "FAC/CR-HVAC",
        "actual_location": "UTIL-ROOF-N",
        "cost_center": "CC-4400",
    },
    {
        "asset_code": "DEMO-AST-011",
        "asset_name": "Conference AV System",
        "category_code": "IT",
        "serial_no": "AV-1102",
        "functional_location": "IT/ENG",
        "actual_location": "OFF-WING-C-306",
        "cost_center": "CC-5100",
    },
    {
        "asset_code": "DEMO-AST-012",
        "asset_name": "Packaging Line B",
        "category_code": "EQUIPMENT",
        "rfid_code": "RFID-DEMO-012",
        "serial_no": "PKG-B-02",
        "functional_location": "PROD/BLD-A/LINE-01",
        "actual_location": "LINE-A-BAY2",
        "cost_center": "CC-4100",
    },
]


def _all_permission_codes(db: Session) -> list[str]:
    """Every permission code in the catalog (after sync_modules)."""
    return sorted({str(c) for c in db.scalars(select(Permission.code)).all() if c})


def _resolve_role_permission_codes(db: Session, spec: dict[str, object]) -> list[str]:
    perms = spec.get("permissions")
    if perms == "__all__":
        return _all_permission_codes(db)
    return list(perms)  # type: ignore[arg-type]


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
    """Single canonical plant — migrate legacy DEMO-01 and remove extras."""
    code = str(TAKEDA_PLANT["code"])
    row = db.scalar(select(OrgUnit).where(OrgUnit.type == "PLANT", OrgUnit.code == code))
    if row is None:
        for legacy in LEGACY_PLANT_CODES:
            legacy_row = db.scalar(
                select(OrgUnit).where(OrgUnit.type == "PLANT", OrgUnit.code == legacy)
            )
            if legacy_row is not None:
                legacy_row.code = code
                legacy_row.name = str(TAKEDA_PLANT["name"])
                row = legacy_row
                break
    if row is None:
        row = OrgUnit(
            name=str(TAKEDA_PLANT["name"]),
            code=code,
            type=str(TAKEDA_PLANT["type"]),
            parent_id=None,
        )
        db.add(row)
        db.flush()
    else:
        row.name = str(TAKEDA_PLANT["name"])

    others = list(
        db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT", OrgUnit.id != row.id)).all()
    )
    fallback_cc = db.scalar(
        select(CostCenterMaster.id).where(CostCenterMaster.plant_id == row.id).limit(1)
    )
    for other in others:
        db.execute(
            update(AssetLocationInformation)
            .where(AssetLocationInformation.plant_id == other.id)
            .values(plant_id=row.id)
        )
        other_cc_rows = list(
            db.scalars(select(CostCenterMaster).where(CostCenterMaster.plant_id == other.id)).all()
        )
        for occ in other_cc_rows:
            target_cc = db.scalar(
                select(CostCenterMaster.id).where(
                    CostCenterMaster.plant_id == row.id,
                    CostCenterMaster.code == occ.code,
                )
            )
            mapped_cc = int(target_cc) if target_cc is not None else int(fallback_cc) if fallback_cc else None
            if mapped_cc is not None:
                db.execute(
                    update(PhysicalOrder)
                    .where(PhysicalOrder.cost_center_id == occ.id)
                    .values(cost_center_id=mapped_cc, plant_id=row.id)
                )
        db.execute(
            update(PhysicalOrder)
            .where(PhysicalOrder.plant_id == other.id)
            .values(plant_id=row.id)
        )
        db.execute(
            update(user_org_unit)
            .where(user_org_unit.c.org_unit_id == other.id)
            .values(org_unit_id=row.id)
        )
        db.delete(other)
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


def _demo_asset_number(asset_code: str) -> int:
    return int(str(asset_code).rsplit("-", 1)[-1])


def _enrich_demo_asset_spec(spec: dict[str, object], *, today: date) -> dict[str, object]:
    """Fill every optional demo field so list/detail views show no blanks."""
    s = dict(spec)
    code = str(s["asset_code"]).upper()
    n = _demo_asset_number(code)
    cat = str(s["category_code"])
    meta = _CATEGORY_DEMO_META.get(cat, _CATEGORY_DEMO_META["EQUIPMENT"])
    cc = str(s["cost_center"])

    s.setdefault("asset_class", meta[0])
    s.setdefault("asset_type", meta[1])
    if not s.get("rfid_code"):
        s["rfid_code"] = f"RFID-DEMO-{n:03d}"
    if not s.get("serial_no"):
        s["serial_no"] = f"SN-{code}"

    s.setdefault("sub_location", f"Sub-location — {s['asset_name']}")
    s.setdefault("building", "A")
    s.setdefault("floor", "1")
    if not s.get("room"):
        s["room"] = str(200 + n)
    s.setdefault("zone", meta[2])

    s["profit_center"] = _COST_CENTER_TO_PROFIT_CENTER.get(cc, "PC-100")
    s.setdefault("laboratory", meta[2])
    s.setdefault("party_details", f"Supplier — {s['asset_name']}")
    s.setdefault("invoice_no", f"INV-2024-{1000 + n}")
    s.setdefault("voucher_no", f"VCH-{cc.replace('CC-', '')}-{n:02d}")
    s.setdefault("grn_no", f"GRN-2024-{500 + n}")
    s.setdefault("vendor_name", "Takeda Demo Vendor")
    s.setdefault("po_number", f"PO-{code}")
    s.setdefault("currency", "USD")
    s.setdefault("life_span", "10 years")
    s.setdefault("gross_block", meta[3])
    s.setdefault("depreciation_rate", meta[4])

    base = date(2024, 3, 1)
    s.setdefault("invoice_date", base + timedelta(days=n * 7))
    s.setdefault("voucher_date", base + timedelta(days=n * 7 + 3))
    s.setdefault("grn_date", base + timedelta(days=n * 7 + 5))
    s.setdefault("put_to_use_date", base + timedelta(days=n * 7 + 14))
    s.setdefault("cap_date", s["put_to_use_date"])

    s.setdefault("inventory_count", 1)
    # Physical count / verification only change after a physical order scan (see orders service).
    s.setdefault("physical_count", 0)
    s.setdefault("last_verification_date", None)
    s.setdefault("verification_status", None)
    s.setdefault("verification_remarks", None)

    s.setdefault("inventory_no", f"INV-{code}")
    s.setdefault("asset_description", f"Operational asset — {s['asset_name']}")
    s.setdefault("engineering_description", f"Engineering install and calibration notes for {code}.")
    s.setdefault("qa_description", f"QA classification per internal SOP for {cat} assets.")
    s.setdefault("is_local_finance_user", False)
    s.setdefault("asset_allocation", f"Allocated to {cc}")
    s.setdefault("pm_equipment_id", f"PM-{n:04d}")

    return s


def _apply_demo_asset_spec(
    db: Session,
    asset_id: int,
    spec: dict[str, object],
    *,
    plant_id: int,
) -> None:
    """Upsert all asset sections from an enriched demo spec."""
    code = str(spec["asset_code"]).upper()
    cat_id = _category_id(db, str(spec["category_code"]))

    asset = db.get(AssetMaster, asset_id)
    if asset is None:
        return
    asset.asset_name = str(spec["asset_name"])
    asset.asset_class = str(spec["asset_class"])
    asset.asset_type = str(spec["asset_type"])
    asset.rfid_code = str(spec["rfid_code"])
    asset.serial_no = str(spec["serial_no"])
    asset.asset_category_id = int(cat_id) if cat_id else None
    asset.lifecycle_status = "active"
    asset.approval_status = "approved"
    asset.ownership_type = "owned"

    info = db.scalar(select(AssetInformation).where(AssetInformation.asset_id == asset_id))
    if info is None:
        info = AssetInformation(asset_id=asset_id)
        db.add(info)
    info.inventory_no = str(spec["inventory_no"])
    info.asset_description = str(spec["asset_description"])
    info.engineering_description = str(spec["engineering_description"])
    info.qa_description = str(spec["qa_description"])
    info.is_local_finance_user = bool(spec["is_local_finance_user"])
    info.asset_allocation = str(spec["asset_allocation"])
    info.pm_equipment_id = str(spec["pm_equipment_id"])

    loc = db.scalar(select(AssetLocationInformation).where(AssetLocationInformation.asset_id == asset_id))
    if loc is None:
        loc = AssetLocationInformation(asset_id=asset_id)
        db.add(loc)
    loc.plant_id = plant_id
    loc.sub_location = str(spec["sub_location"])
    loc.functional_location = str(spec["functional_location"])
    loc.actual_location = str(spec["actual_location"])
    loc.building = str(spec["building"])
    loc.floor = str(spec["floor"])
    loc.room = str(spec["room"])
    loc.zone = str(spec["zone"])

    fin = db.scalar(select(AssetFinancialInformation).where(AssetFinancialInformation.asset_id == asset_id))
    if fin is None:
        fin = AssetFinancialInformation(asset_id=asset_id)
        db.add(fin)
    fin.cost_center = str(spec["cost_center"])
    fin.profit_center = str(spec["profit_center"])
    fin.laboratory = str(spec["laboratory"])
    fin.cap_date = spec["cap_date"]  # type: ignore[assignment]
    fin.gross_block = spec["gross_block"]  # type: ignore[assignment]
    fin.party_details = str(spec["party_details"])
    fin.invoice_no = str(spec["invoice_no"])
    fin.invoice_date = spec["invoice_date"]  # type: ignore[assignment]
    fin.voucher_no = str(spec["voucher_no"])
    fin.voucher_date = spec["voucher_date"]  # type: ignore[assignment]
    fin.grn_no = str(spec["grn_no"])
    fin.grn_date = spec["grn_date"]  # type: ignore[assignment]
    fin.put_to_use_date = spec["put_to_use_date"]  # type: ignore[assignment]
    fin.depreciation_rate = spec["depreciation_rate"]  # type: ignore[assignment]
    fin.life_span = str(spec["life_span"])
    fin.vendor_name = str(spec["vendor_name"])
    fin.po_number = str(spec["po_number"])
    fin.currency = str(spec["currency"])

    inv = db.scalar(select(AssetInventoryInformation).where(AssetInventoryInformation.asset_id == asset_id))
    if inv is None:
        inv = AssetInventoryInformation(asset_id=asset_id)
        db.add(inv)
    inv.inventory_count = int(spec["inventory_count"])
    inv.physical_count = int(spec["physical_count"])
    inv.last_verification_date = spec["last_verification_date"]  # type: ignore[assignment]
    inv.verification_status = str(spec["verification_status"])
    inv.verification_remarks = str(spec["verification_remarks"])


def _seed_reference_masters(db: Session, *, plant_id: int) -> None:
    """Hierarchical masters: plant→functional→actual and plant→cost→profit."""
    fl_specs = list(REFERENCE_MASTER_SPECS["functional_locations"])  # type: ignore[arg-type]
    al_specs = list(REFERENCE_MASTER_SPECS["actual_locations"])  # type: ignore[arg-type]
    cc_specs = list(REFERENCE_MASTER_SPECS["cost_centers"])  # type: ignore[arg-type]
    pc_specs = list(REFERENCE_MASTER_SPECS["profit_centers"])  # type: ignore[arg-type]

    fl_created = fl_updated = 0
    fl_by_code: dict[str, FunctionalLocationMaster] = {}
    for code, desc in fl_specs:
        row = db.scalar(
            select(FunctionalLocationMaster).where(
                FunctionalLocationMaster.plant_id == plant_id,
                FunctionalLocationMaster.code == code,
            )
        )
        if row is None:
            row = FunctionalLocationMaster(
                code=str(code), description=str(desc), plant_id=plant_id, is_active=True
            )
            db.add(row)
            db.flush()
            fl_created += 1
        else:
            row.description = str(desc)
            row.is_active = True
            fl_updated += 1
        fl_by_code[str(code)] = row

    al_created = 0
    for fl_code, code, desc in al_specs:
        fl = fl_by_code.get(str(fl_code))
        if fl is None:
            continue
        row = db.scalar(
            select(ActualLocationMaster).where(
                ActualLocationMaster.functional_location_id == fl.id,
                ActualLocationMaster.code == str(code),
            )
        )
        if row is None:
            db.add(
                ActualLocationMaster(
                    code=str(code),
                    description=str(desc),
                    functional_location_id=fl.id,
                    is_active=True,
                )
            )
            al_created += 1
        else:
            row.description = str(desc)
            row.is_active = True

    cc_created = cc_updated = 0
    cc_by_code: dict[str, CostCenterMaster] = {}
    for code, desc in cc_specs:
        row = db.scalar(
            select(CostCenterMaster).where(
                CostCenterMaster.plant_id == plant_id,
                CostCenterMaster.code == str(code),
            )
        )
        if row is None:
            row = CostCenterMaster(
                code=str(code), description=str(desc), plant_id=plant_id, is_active=True
            )
            db.add(row)
            db.flush()
            cc_created += 1
        else:
            row.description = str(desc)
            row.is_active = True
            cc_updated += 1
        cc_by_code[str(code)] = row

    pc_created = 0
    for cc_code, code, desc in pc_specs:
        cc = cc_by_code.get(str(cc_code))
        if cc is None:
            continue
        row = db.scalar(
            select(ProfitCenterMaster).where(
                ProfitCenterMaster.cost_center_id == cc.id,
                ProfitCenterMaster.code == str(code),
            )
        )
        if row is None:
            db.add(
                ProfitCenterMaster(
                    code=str(code), description=str(desc), cost_center_id=cc.id, is_active=True
                )
            )
            pc_created += 1
        else:
            row.description = str(desc)
            row.is_active = True

    db.commit()
    print(
        f"  reference masters: {len(fl_specs)} functional (+{fl_created} new, {fl_updated} updated), "
        f"{len(al_specs)} actual (+{al_created} new), "
        f"{len(cc_specs)} cost centers (+{cc_created} new, {cc_updated} updated), "
        f"{len(pc_specs)} profit centers (+{pc_created} new)"
    )


def _seed_demo_assets(db: Session, *, plant_id: int) -> None:
    today = date.today()
    for raw in DEMO_ASSET_SPECS:
        spec = _enrich_demo_asset_spec(raw, today=today)
        code = str(spec["asset_code"]).upper()
        existing = db.scalar(
            select(AssetMaster.id).where(
                AssetMaster.asset_code == code,
                AssetMaster.deleted_at.is_(None),
            )
        )
        if existing is not None:
            _apply_demo_asset_spec(db, int(existing), spec, plant_id=plant_id)
            has_audit = db.scalar(
                select(AssetAuditEvent.id).where(AssetAuditEvent.asset_id == existing).limit(1)
            )
            if has_audit is None:
                log_asset_event(
                    db,
                    asset_id=int(existing),
                    actor_user_id=None,
                    action="created",
                    new_value={"asset_code": code, "source": "seed"},
                )
            db.commit()
            print(f"  updated: {code} (all fields populated)")
            continue

        asset = AssetMaster(
            asset_code=code,
            asset_name=str(spec["asset_name"]),
            source_type="manual",
            created_by=None,
            approved_by=None,
        )
        db.add(asset)
        db.flush()
        _apply_demo_asset_spec(db, asset.id, spec, plant_id=plant_id)
        log_asset_event(
            db,
            asset_id=asset.id,
            actor_user_id=None,
            action="created",
            new_value={"asset_code": code, "source": "seed"},
        )
        db.commit()
        print(f"  created: {code} — {spec['asset_name']}")


def _cost_center_id(db: Session, *, plant_id: int, code: str) -> int:
    cid = db.scalar(
        select(CostCenterMaster.id).where(
            CostCenterMaster.plant_id == plant_id,
            CostCenterMaster.code == code,
        )
    )
    if cid is None:
        raise RuntimeError(f"Cost center {code!r} missing for plant {plant_id}")
    return int(cid)


def _asset_ids_for_codes(db: Session, codes: list[str]) -> list[int]:
    out: list[int] = []
    for code in codes:
        aid = db.scalar(
            select(AssetMaster.id).where(
                AssetMaster.asset_code == code.upper(),
                AssetMaster.deleted_at.is_(None),
            )
        )
        if aid is not None:
            out.append(int(aid))
    return out


def _seed_demo_orders(db: Session, *, plant_id: int) -> None:
    """Sample physical orders across lifecycle states for UI testing."""
    from datetime import datetime, timezone

    cc4100 = _cost_center_id(db, plant_id=plant_id, code="CC-4100")
    cc4200 = _cost_center_id(db, plant_id=plant_id, code="CC-4200")
    now = datetime.now(timezone.utc)

    specs: list[dict[str, object]] = [
        {
            "order_number": "PVO-SEED-00001",
            "status": ORDER_STATUS_PENDING_APPROVAL,
            "cost_center_id": cc4100,
            "assets": ["DEMO-AST-001"],
        },
        {
            "order_number": "PVO-SEED-00002",
            "status": ORDER_STATUS_APPROVED,
            "cost_center_id": cc4100,
            "assets": ["DEMO-AST-002"],
        },
        {
            "order_number": "PVO-SEED-00003",
            "status": ORDER_STATUS_IN_PROGRESS,
            "cost_center_id": cc4200,
            "assets": ["DEMO-AST-003"],
            "verified": True,
        },
        {
            "order_number": "PVO-SEED-00004",
            "status": ORDER_STATUS_PENDING_CLOSURE,
            "cost_center_id": cc4200,
            "assets": ["DEMO-AST-004"],
            "all_verified": True,
        },
        {
            "order_number": "PVO-SEED-00005",
            "status": ORDER_STATUS_COMPLETED,
            "cost_center_id": cc4100,
            "assets": ["DEMO-AST-005"],
            "all_verified": True,
        },
    ]

    for spec in specs:
        onum = str(spec["order_number"])
        existing = db.scalar(select(PhysicalOrder.id).where(PhysicalOrder.order_number == onum))
        if existing is not None:
            print(f"  skip order: {onum}")
            continue
        asset_codes = list(spec["assets"])  # type: ignore[arg-type]
        asset_ids = _asset_ids_for_codes(db, asset_codes)
        if not asset_ids:
            print(f"  skip order {onum}: assets missing")
            continue
        order = PhysicalOrder(
            order_number=onum,
            plant_id=plant_id,
            cost_center_id=int(spec["cost_center_id"]),
            created_by=None,
            assigned_to=None,
            status=str(spec["status"]),
            remarks="Seeded demo order",
        )
        if spec.get("all_verified") or spec.get("verified"):
            order.started_at = now
            order.completed_at = now if spec["status"] == ORDER_STATUS_COMPLETED else None
        db.add(order)
        db.flush()
        for aid in asset_ids:
            vstatus = ITEM_STATUS_PENDING
            if spec.get("rejected"):
                vstatus = ITEM_STATUS_REJECTED
            elif spec.get("all_verified") or (spec.get("verified") and aid == asset_ids[0]):
                vstatus = ITEM_STATUS_APPROVED
            item = PhysicalOrderItem(
                order_id=int(order.id),
                asset_id=aid,
                verification_status=vstatus,
                rejection_reason="Demo rejection" if spec.get("rejected") else None,
                scan_time=now if vstatus == ITEM_STATUS_APPROVED else None,
            )
            db.add(item)
        log_order_event(
            db,
            order_id=int(order.id),
            action="order_created",
            actor_user_id=None,
            new_value={"order_number": onum, "seed": True},
        )
        print(f"  order: {onum} ({spec['status']})")


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
            codes = _resolve_role_permission_codes(db, spec)
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

        print("\nReference masters:")
        try:
            _seed_reference_masters(db, plant_id=int(plant.id))
        except IntegrityError as exc:
            db.rollback()
            print(f"  error: {exc}", file=sys.stderr)

        print("\nDemo assets:")
        try:
            _seed_demo_assets(db, plant_id=int(plant.id))
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            print(f"  error: {exc}", file=sys.stderr)
            return 4

        print("\nDemo physical orders:")
        try:
            _seed_demo_orders(db, plant_id=int(plant.id))
            db.commit()
        except (IntegrityError, RuntimeError) as exc:
            db.rollback()
            print(f"  error: {exc}", file=sys.stderr)

        print("\nDone.")
        print("Active user-creation workflow is mapped to users.create (new users need approval).")
        print("Physical order workflows mapped to order.create and order.complete.")
        print("USER_CREATED email uses one temporary password ({{temp_password}}).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
