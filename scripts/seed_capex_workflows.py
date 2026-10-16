#!/usr/bin/env python3
"""Seed CapEx roles, approval workflows, and action mappings.

Creates:
  - Roles: Cost Center User, Department HOD, Engineering, Central Finance
  - Workflow A: capitalization_request → HOD → Central Finance
    mapped to capitalization.submit
  - Workflow B: capitalization_request_engineering → HOD → Engineering → Central Finance
    mapped to capitalization.submit_with_engineering

Run from the project root (venv activated)::

    .venv/bin/python scripts/seed_capex_workflows.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.platform.approvals.assignment_service import WorkflowMappingService
from modules.platform.approvals.model import ApprovalStep, ApprovalWorkflow
from modules.platform.approvals.service import ApprovalWorkflowService
from modules.platform.permissions.model import Permission
from modules.platform.roles.model import Role
from modules.rbac_sync import sync_all_modules_to_db

ROLE_SPECS: list[dict[str, object]] = [
    {
        "name": "Cost Center User",
        "description": "Create and submit asset capitalization forms; create/receive asset transfers.",
        "permissions": [
            "capitalization.view",
            "capitalization.create",
            "capitalization.update",
            "capitalization.submit",
            "capitalization.submit_with_engineering",
            "capitalization.reassign",
            "transfer.view",
            "transfer.create",
            "transfer.update",
            "transfer.receive",
            "asset.view",
            "task.view",
            "task.act",
            "approval.view",
        ],
    },
    {
        "name": "Department HOD",
        "description": "Approve or reject capitalization forms at department level.",
        "permissions": [
            "capitalization.view",
            "approval.view",
            "approval.act",
            "task.view",
            "task.act",
            "asset.view",
        ],
    },
    {
        "name": "Engineering",
        "description": "Engineering review for capitalization forms when required.",
        "permissions": [
            "capitalization.view",
            "approval.view",
            "approval.act",
            "task.view",
            "task.act",
            "asset.view",
        ],
    },
    {
        "name": "Central Finance",
        "description": "Final capitalization approval; asset transfer CF approve/confirm; may create assets from approved forms.",
        "permissions": [
            "capitalization.view",
            "capitalization.reassign",
            "transfer.view",
            "transfer.approve",
            "transfer.confirm",
            "transfer.manage",
            "approval.view",
            "approval.act",
            "task.view",
            "task.act",
            "asset.view",
            "asset.create",
            "asset.update",
        ],
    },
]

WORKFLOW_SPECS: list[dict[str, object]] = [
    {
        "name": "Capitalization — HOD then Central Finance",
        "entity_type": "capitalization_request",
        "activate": True,
        "map_action": "capitalization.submit",
        "steps": [
            (1, "Department HOD", 1),
            (2, "Central Finance", 1),
        ],
    },
    {
        "name": "Capitalization — HOD, Engineering, Central Finance",
        "entity_type": "capitalization_request_engineering",
        "activate": True,
        "map_action": "capitalization.submit_with_engineering",
        "steps": [
            (1, "Department HOD", 1),
            (2, "Engineering", 1),
            (3, "Central Finance", 1),
        ],
    },
]


def _upsert_role(
    db: Session,
    *,
    name: str,
    description: str | None,
    permission_codes: list[str],
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
        existing.description = description
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
        raise RuntimeError(f"Role not found: {name!r}")
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
            )
            db.commit()
            print(f"{'Created' if created else 'Updated'} role: {role.name}")

        for spec in WORKFLOW_SPECS:
            steps = [(int(a), str(b), int(c)) for a, b, c in spec["steps"]]  # type: ignore[misc]
            wf = _seed_workflow(
                db,
                name=str(spec["name"]),
                entity_type=str(spec["entity_type"]),
                steps=steps,
                activate=bool(spec["activate"]),
                map_action=str(spec["map_action"]) if spec.get("map_action") else None,
            )
            role_names = {
                int(r.id): r.name
                for r in db.scalars(select(Role)).all()
            }
            step_names = " → ".join(
                f"{s.step_order}:{role_names.get(int(s.approver_role_id), '?')}"
                for s in sorted(wf.steps, key=lambda x: int(x.step_order))
            )
            print(
                f"Workflow '{wf.name}' active={wf.is_active} "
                f"entity={wf.entity_type} map={spec.get('map_action')} [{step_names}]"
            )

        print("\nCapEx workflows ready.")
        print("Assign users to: Cost Center User, Department HOD, Engineering, Central Finance.")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
