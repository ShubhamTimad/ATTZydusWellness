#!/usr/bin/env python3
"""Seed Asset Transfer approval workflow (industry default).

Creates / updates:
  - Ensures roles have transfer permissions (merge)
  - Workflow: transfer_order
      Department HOD (approve) → Central Finance (approve)
      → Cost Center User (receive) → Central Finance (confirm)
      → Central Finance (close)
    mapped to transfer.submit

Safer for existing "Asset Transfer" workflow:
  - Keep existing approve steps / role names
  - Set step_kind=approve when missing
  - Append receive / confirm / close steps if absent

Admins can change steps / role names later under Workflow Assignment.

Run from the project root (venv activated)::

    .venv/bin/python scripts/seed_transfer_workflows.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.platform.approvals.assignment_service import WorkflowMappingService
from modules.platform.approvals.model import ApprovalStep, ApprovalWorkflow
from modules.platform.approvals.service import ApprovalWorkflowService
from modules.platform.permissions.model import Permission
from modules.platform.roles.model import Role
from modules.rbac_sync import sync_all_modules_to_db

_TRANSFER_APPROVER = [
    "transfer.view",
    "approval.view",
    "approval.act",
    "task.view",
    "task.act",
    "asset.view",
]

ROLE_SPECS: list[dict[str, object]] = [
    {
        "name": "Cost Center User",
        "description": "Create/submit asset transfers and receive as destination custodian.",
        "permissions": [
            "transfer.view",
            "transfer.create",
            "transfer.update",
            "transfer.submit",
            "transfer.receive",
            "asset.view",
            "masters.view",
            "task.view",
            "task.act",
            "approval.view",
            "approval.act",
        ],
        "merge": True,
    },
    {
        "name": "Department HOD",
        "description": "First approver on asset transfer (originating department).",
        "permissions": list(_TRANSFER_APPROVER),
        "merge": True,
    },
    {
        "name": "Central Finance",
        "description": "Transfer approval chain + post-receive confirm/close.",
        "permissions": [
            *_TRANSFER_APPROVER,
            "transfer.approve",
            "transfer.confirm",
            "transfer.manage",
        ],
        "merge": True,
    },
]

# Fresh seed: (step_order, role_name, required_approvals, step_kind)
DEFAULT_STEPS: list[tuple[int, str, int, str]] = [
    (1, "Department HOD", 1, "approve"),
    (2, "Central Finance", 1, "approve"),
    (3, "Cost Center User", 1, "receive"),
    (4, "Central Finance", 1, "confirm"),
    (5, "Central Finance", 1, "close"),
]

# Appended when missing on an existing workflow (role, kind)
OPERATIONAL_APPEND: list[tuple[str, str]] = [
    ("Cost Center User", "receive"),
    ("Central Finance", "confirm"),
    ("Central Finance", "close"),
]


def _upsert_role(
    db: Session,
    *,
    name: str,
    description: str | None,
    permission_codes: list[str],
    merge: bool,
) -> tuple[Role, bool]:
    perms = list(db.scalars(select(Permission).where(Permission.code.in_(permission_codes))).all())
    found = {p.code for p in perms}
    missing = [c for c in permission_codes if c not in found]
    if missing:
        raise RuntimeError(
            f"Missing permission codes for role {name!r}: {missing}. "
            "Ensure RBAC sync has run (restart API or sync permissions)."
        )
    existing = db.scalar(select(Role).where(Role.name == name))
    if existing is not None:
        existing.description = description or existing.description
        if merge:
            by_code = {p.code: p for p in existing.permissions}
            for p in perms:
                by_code[p.code] = p
            existing.permissions = list(by_code.values())
        else:
            existing.permissions = perms
        return existing, False
    role = Role(name=name, description=description)
    role.permissions = perms
    db.add(role)
    db.flush()
    return role, True


def _role_id(db: Session, name: str) -> int:
    rid = db.scalar(select(Role.id).where(Role.name == name))
    if rid is None:
        raise RuntimeError(f"Role not found: {name!r}. Run seed_disposal_workflows.py first or create the role.")
    return int(rid)


def _seed_workflow(db: Session) -> ApprovalWorkflow:
    wf_svc = ApprovalWorkflowService(db)
    map_svc = WorkflowMappingService(db)
    name = "Asset Transfer"
    entity_type = "transfer_order"
    map_action = "transfer.submit"

    wf = db.scalar(select(ApprovalWorkflow).where(ApprovalWorkflow.name == name))
    created = wf is None
    if wf is None:
        wf = ApprovalWorkflow(
            name=name,
            entity_type=entity_type,
            is_active=False,
            created_by=None,
        )
        db.add(wf)
        db.flush()
        for step_order, role_name, required, kind in DEFAULT_STEPS:
            db.add(
                ApprovalStep(
                    workflow_id=int(wf.id),
                    step_order=int(step_order),
                    approver_role_id=_role_id(db, role_name),
                    required_approvals=int(required),
                    step_kind=kind,
                )
            )
        db.commit()
    else:
        wf.entity_type = entity_type
        was_active = bool(wf.is_active)
        if was_active:
            wf.is_active = False
            db.flush()

        steps = list(
            db.scalars(
                select(ApprovalStep)
                .where(ApprovalStep.workflow_id == int(wf.id))
                .order_by(ApprovalStep.step_order.asc())
            ).all()
        )
        for s in steps:
            if not getattr(s, "step_kind", None):
                s.step_kind = "approve"
            elif str(s.step_kind).strip() == "":
                s.step_kind = "approve"

        existing_kinds = {str(getattr(s, "step_kind", None) or "approve").lower() for s in steps}
        next_order = max((int(s.step_order) for s in steps), default=0) + 1
        for role_name, kind in OPERATIONAL_APPEND:
            if kind in existing_kinds:
                continue
            db.add(
                ApprovalStep(
                    workflow_id=int(wf.id),
                    step_order=next_order,
                    approver_role_id=_role_id(db, role_name),
                    required_approvals=1,
                    step_kind=kind,
                )
            )
            existing_kinds.add(kind)
            next_order += 1
        db.commit()

        if was_active:
            wf = wf_svc.activate_workflow(int(wf.id), actor_user_id=None)
            db.commit()

    wf = wf_svc.get_workflow(int(wf.id))
    if not wf.steps:
        raise RuntimeError(f"Workflow {name!r} has no steps after seed.")

    if created or not wf.is_active:
        if not wf.is_active:
            wf = wf_svc.activate_workflow(int(wf.id), actor_user_id=None)
            db.commit()

    map_svc.create_mapping(action_code=map_action, workflow_id=int(wf.id))
    # Re-query so relationship includes any appended steps.
    db.expire_all()
    return wf_svc.get_workflow(int(wf.id))


def main() -> int:
    db = SessionLocal()
    try:
        sync_stats = sync_all_modules_to_db(db)
        db.commit()
        print(
            f"RBAC sync: features={sync_stats.get('features', 0)} "
            f"permissions={sync_stats.get('permissions', 0)}"
        )

        for spec in ROLE_SPECS:
            role, created = _upsert_role(
                db,
                name=str(spec["name"]),
                description=str(spec["description"]) if spec.get("description") else None,
                permission_codes=list(spec["permissions"]),  # type: ignore[arg-type]
                merge=bool(spec.get("merge")),
            )
            db.commit()
            print(f"{'Created' if created else 'Updated'} role: {role.name}")

        wf = _seed_workflow(db)
        role_names = {int(r.id): r.name for r in db.scalars(select(Role)).all()}
        step_names = " → ".join(
            f"{s.step_order}:{role_names.get(int(s.approver_role_id), '?')}({getattr(s, 'step_kind', 'approve')})"
            for s in sorted(wf.steps, key=lambda x: int(x.step_order))
        )
        print(
            f"Workflow '{wf.name}' active={wf.is_active} "
            f"entity={wf.entity_type} map=transfer.submit [{step_names}]"
        )

        print("\nTransfer workflow ready.")
        print(
            "Default chain: HOD approve → CF approve → CC receive → CF confirm → CF close."
        )
        print("Change steps/kinds anytime under Workflow Assignment (entity: transfer_order).")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
