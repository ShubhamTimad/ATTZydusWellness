from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
import string
from urllib.parse import quote

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from core.password_policy import validate_password
from core.phone import normalize_phone
from core.permissions import invalidate_permission_cache
from core.security import hash_password
from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, TaskAuditLog
from modules.errors import NotFoundError, RbacSafetyError
from modules.platform.auth.model import PasswordResetToken, UserSession
from modules.platform.org_units.model import OrgUnit
from modules.asset_masters.model import CostCenterMaster
from modules.assets.service import validate_asset_image
from modules.platform.rbac_audit.service import RbacAuditService
from modules.rbac_safety import (
    assert_did_not_remove_last_role_based_admin,
    assert_self_role_assign_keeps_users_view,
    assert_self_role_update_keeps_users_view,
    count_superusers,
    count_users_with_admin_capability,
)
from modules.platform.rbac_versioning.service import bump_user_permission_version
from modules.platform.roles.model import Role
from modules.rbac_association import user_cost_center, user_department, user_org_unit
from modules.platform.users.model import User
from modules.platform.users.schema import UserCreate, UserUpdate
from modules.platform.approvals.service import ApprovalEngineService
from modules.platform.mfa.policy_hooks import maybe_send_mfa_setup_for_user
from modules.platform.mfa.notify import create_mfa_setup_link
from modules.platform.emails.service import EmailNotificationService, enqueue_trigger_events
from modules.platform.auth_policy.service import get_global_policy


class DuplicateEmailError(Exception):
    """Another user already owns this email address."""


class DuplicatePhoneError(Exception):
    """Another user already owns this phone number."""

class DuplicateUsernameError(Exception):
    """Another user already owns this username."""


def _role_ids_from_updates(updates: dict[str, object]) -> list[int] | None:
    """Role set from a patch. ``role_ids`` wins; ``role_id`` replaces with one role."""
    if "role_ids" in updates and updates["role_ids"] is not None:
        return [int(rid) for rid in updates["role_ids"]]  # type: ignore[union-attr]
    if "role_id" in updates and updates["role_id"] is not None:
        return [int(updates["role_id"])]  # type: ignore[arg-type]
    return None


class UserService:
    def __init__(self, db: Session) -> None:
        self._db = db

    @staticmethod
    def _normalize_phone(phone: str) -> str:
        return normalize_phone(phone)

    @staticmethod
    def _generate_password() -> str:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+[]{}"
        return "".join(secrets.choice(alphabet) for _ in range(20))

    def _require_plant(self, org_unit_id: int) -> OrgUnit:
        org = self._db.get(OrgUnit, org_unit_id)
        if org is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        if (org.type or "").upper() != "PLANT":
            raise ValueError("org_unit_id must be a plant")
        return org

    def _require_roles(self, role_ids: list[int]) -> list[Role]:
        if not role_ids:
            raise ValueError("At least one role is required")
        roles: list[Role] = []
        for rid in role_ids:
            role = self._db.get(Role, int(rid))
            if role is None:
                raise NotFoundError("Role", int(rid))
            roles.append(role)
        return roles

    @staticmethod
    def _role_label(roles: list[Role]) -> str:
        return ", ".join(r.name for r in roles)

    def _require_plants(self, org_unit_ids: list[int]) -> list[OrgUnit]:
        if not org_unit_ids:
            raise ValueError("At least one plant is required")
        return [self._require_plant(int(oid)) for oid in org_unit_ids]

    def _resolve_departments(
        self, department_ids: list[int], *, plant_ids: set[int]
    ) -> list[OrgUnit]:
        if not department_ids:
            return []
        if not plant_ids:
            raise ValueError("Assign a plant before setting departments")
        out: list[OrgUnit] = []
        for department_id in department_ids:
            dept = self._db.get(OrgUnit, int(department_id))
            if dept is None:
                raise NotFoundError("Department", department_id)
            if (dept.type or "").upper() != "DEPARTMENT":
                raise ValueError("department_ids must be departments")
            if dept.parent_id is None or int(dept.parent_id) not in plant_ids:
                raise ValueError("Each department must belong to one of the selected plants")
            out.append(dept)
        return out

    def _resolve_cost_centers(
        self, cost_center_ids: list[int], *, plant_ids: set[int]
    ) -> list[CostCenterMaster]:
        if not cost_center_ids:
            return []
        if not plant_ids:
            raise ValueError("Assign a plant before setting cost centers")
        out: list[CostCenterMaster] = []
        for cost_center_id in cost_center_ids:
            cc = self._db.get(CostCenterMaster, int(cost_center_id))
            if cc is None:
                raise NotFoundError("Cost center", cost_center_id)
            if int(cc.plant_id) not in plant_ids:
                raise ValueError("Each cost center must belong to one of the selected plants")
            if not bool(cc.is_active):
                raise ValueError("Cost center is inactive")
            out.append(cc)
        return out

    @staticmethod
    def _user_load_options():
        return (
            selectinload(User.roles),
            selectinload(User.org_units),
            selectinload(User.departments),
            selectinload(User.cost_centers),
            selectinload(User.mfa_record),
        )

    @staticmethod
    def _assignment_audit_fields(user: User) -> dict[str, object]:
        """Human-readable plant / department / cost-center labels for RBAC audit diffs."""
        plant_names = sorted(
            ou.name.strip() for ou in (user.org_units or []) if (ou.name or "").strip()
        )
        dept_labels = sorted(
            (
                f"{d.code} — {d.name}"
                if (d.code or "").strip()
                else (d.name or "").strip()
            )
            for d in (user.departments or [])
            if (d.name or "").strip() or (d.code or "").strip()
        )
        cc_labels = sorted(
            (
                f"{c.code} — {c.name}"
                if (c.name or "").strip()
                else (c.code or "").strip()
            )
            for c in (user.cost_centers or [])
            if (c.code or "").strip()
        )
        return {
            "org_unit_name": ", ".join(plant_names) if plant_names else None,
            "department_name": ", ".join(dept_labels) if dept_labels else None,
            "cost_center_name": ", ".join(cc_labels) if cc_labels else None,
        }

    def _revoke_user_access(self, user_id: int) -> None:
        """Invalidate open sessions and unused password-reset tokens for a deactivated user."""
        now = datetime.now(timezone.utc)
        self._db.execute(
            update(UserSession)
            .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        self._db.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None))
            .values(used_at=now)
        )

    def get_photo(self, user_id: int) -> tuple[bytes, str]:
        user = self._db.get(User, user_id)
        if user is None or not user.photo_data or not user.photo_content_type:
            raise NotFoundError("User photo", user_id)
        return bytes(user.photo_data), user.photo_content_type

    def set_photo(self, user_id: int, data: bytes) -> None:
        content_type = validate_asset_image(data, label="Profile photo")
        user = self._db.get(User, user_id)
        if user is None:
            raise NotFoundError("User", user_id)
        user.photo_data = data
        user.photo_content_type = content_type
        self._db.commit()

    def clear_photo(self, user_id: int) -> None:
        user = self._db.get(User, user_id)
        if user is None:
            raise NotFoundError("User", user_id)
        user.photo_data = None
        user.photo_content_type = None
        self._db.commit()

    def create_user(self, data: UserCreate, *, actor_user_id: int | None = None) -> User:
        phone = self._normalize_phone(data.phone)
        existing_phone = self._db.scalar(select(User.id).where(User.phone == phone))
        if existing_phone is not None:
            raise DuplicatePhoneError

        username_norm = str(data.username).strip()
        if not username_norm:
            raise ValueError("Username is required")
        existing_username = self._db.scalar(select(User.id).where(User.username == username_norm))
        if existing_username is not None:
            raise DuplicateUsernameError

        email_norm = data.email.lower().strip()
        existing_email = self._db.scalar(select(User.id).where(User.email == email_norm))
        if existing_email is not None:
            raise DuplicateEmailError

        roles = self._require_roles(data.role_ids)

        plants = self._require_plants(data.org_unit_ids)
        plant_ids = {int(p.id) for p in plants}
        departments = self._resolve_departments(data.department_ids, plant_ids=plant_ids)
        cost_centers = self._resolve_cost_centers(data.cost_center_ids, plant_ids=plant_ids)

        autogenerated = True
        plain_password = self._generate_password()
        validate_password(plain_password)

        now = datetime.now(timezone.utc)
        user = User(
            full_name=data.full_name.strip(),
            username=username_norm,
            phone=phone,
            email=email_norm,
            hashed_password=hash_password(plain_password),
            password_changed_at=now,
            is_active=bool(data.is_active),
        )
        user.roles = roles
        user.org_units = plants
        user.departments = departments
        user.cost_centers = cost_centers
        self._db.add(user)
        self._db.flush()

        audit = RbacAuditService(self._db)
        audit.log(
            actor_user_id=actor_user_id,
            target_type="user",
            target_id=user.id,
            action="create",
            old_value=None,
            new_value={
                "full_name": user.full_name,
                "username": user.username,
                "phone": user.phone,
                "email": user.email,
                "role_ids": [int(r.id) for r in roles],
                "role_name": self._role_label(roles),
                "org_unit_ids": [int(p.id) for p in plants],
                "department_ids": [int(d.id) for d in departments],
                "cost_center_ids": [int(c.id) for c in cost_centers],
            },
        )
        bump_user_permission_version(self._db, user.id)

        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            # Most likely duplicate phone/email race.
            if self._db.scalar(select(User.id).where(User.phone == phone)) is not None:
                raise DuplicatePhoneError from None
            if self._db.scalar(select(User.id).where(User.username == username_norm)) is not None:
                raise DuplicateUsernameError from None
            if email_norm and self._db.scalar(select(User.id).where(User.email == email_norm)) is not None:
                raise DuplicateEmailError from None
            raise
        user_id = user.id
        self._db.expire_all()
        reloaded = self._db.scalar(
            select(User)
            .where(User.id == user_id)
            .options(*self._user_load_options())
        )
        assert reloaded is not None
        if reloaded.is_active:
            if autogenerated and reloaded.email:
                enqueue_trigger_events(
                    [
                        (
                            "USER_CREATED",
                            {
                                "user_name": reloaded.full_name,
                                "username": reloaded.username,
                                "email": reloaded.email,
                                "company_name": "Takeda Asset Management",
                                "temp_password": plain_password,
                            },
                        )
                    ]
                )
            maybe_send_mfa_setup_for_user(self._db, reloaded)
        return reloaded

    def _users_filter_stmt(
        self,
        *,
        search: str | None = None,
        name: str | None = None,
        phone: str | None = None,
        is_active: bool | None = None,
        is_locked: bool | None = None,
        role_id: int | None = None,
        plant: str | None = None,
        department: str | None = None,
        cost_center: str | None = None,
        with_options: bool = True,
    ):
        stmt = select(User)
        if with_options:
            stmt = stmt.options(*self._user_load_options())
        q = (search or "").strip()
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(
                    User.full_name.ilike(like),
                    User.username.ilike(like),
                    User.email.ilike(like),
                    User.phone.ilike(like),
                )
            )
        name_q = (name or "").strip()
        if name_q:
            like = f"%{name_q}%"
            stmt = stmt.where(
                or_(
                    User.full_name.ilike(like),
                    User.username.ilike(like),
                    User.email.ilike(like),
                )
            )
        phone_q = (phone or "").strip()
        if phone_q:
            stmt = stmt.where(User.phone.ilike(f"%{phone_q}%"))
        if is_active is not None:
            stmt = stmt.where(User.is_active.is_(bool(is_active)))
        if is_locked is True:
            stmt = stmt.where(User.locked_at.is_not(None))
        elif is_locked is False:
            stmt = stmt.where(User.locked_at.is_(None))
        if role_id is not None:
            stmt = stmt.where(User.roles.any(Role.id == int(role_id)))
        plant_name = (plant or "").strip()
        if plant_name:
            stmt = stmt.where(User.org_units.any(OrgUnit.name == plant_name))
        dept_name = (department or "").strip()
        if dept_name:
            stmt = stmt.where(User.departments.any(OrgUnit.name == dept_name))
        cc = (cost_center or "").strip()
        if cc:
            stmt = stmt.where(User.cost_centers.any(CostCenterMaster.code == cc))
        return stmt

    def list_users(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        search: str | None = None,
        name: str | None = None,
        phone: str | None = None,
        is_active: bool | None = None,
        is_locked: bool | None = None,
        role_id: int | None = None,
        plant: str | None = None,
        department: str | None = None,
        cost_center: str | None = None,
    ) -> list[User]:
        stmt = self._users_filter_stmt(
            search=search,
            name=name,
            phone=phone,
            is_active=is_active,
            is_locked=is_locked,
            role_id=role_id,
            plant=plant,
            department=department,
            cost_center=cost_center,
        )
        stmt = stmt.order_by(User.created_at.desc()).offset(offset).limit(limit)
        return list(self._db.scalars(stmt).all())

    def list_users_page(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
        name: str | None = None,
        phone: str | None = None,
        is_active: bool | None = None,
        is_locked: bool | None = None,
        role_id: int | None = None,
        plant: str | None = None,
        department: str | None = None,
        cost_center: str | None = None,
    ) -> tuple[list[User], int]:
        stmt = self._users_filter_stmt(
            search=search,
            name=name,
            phone=phone,
            is_active=is_active,
            is_locked=is_locked,
            role_id=role_id,
            plant=plant,
            department=department,
            cost_center=cost_center,
        )
        count_stmt = self._users_filter_stmt(
            search=search,
            name=name,
            phone=phone,
            is_active=is_active,
            is_locked=is_locked,
            role_id=role_id,
            plant=plant,
            department=department,
            cost_center=cost_center,
            with_options=False,
        )
        total = int(
            self._db.scalar(select(func.count()).select_from(count_stmt.order_by(None).subquery())) or 0
        )
        offset = max(page - 1, 0) * page_size
        items = list(
            self._db.scalars(stmt.order_by(User.created_at.desc()).offset(offset).limit(page_size)).all()
        )
        return items, total

    def list_user_filter_options(self) -> dict[str, list[str]]:
        plants = [
            name
            for name in self._db.scalars(
                select(OrgUnit.name)
                .join(user_org_unit, user_org_unit.c.org_unit_id == OrgUnit.id)
                .distinct()
                .order_by(OrgUnit.name.asc())
            ).all()
            if (name or "").strip()
        ]
        departments = [
            name
            for name in self._db.scalars(
                select(OrgUnit.name)
                .join(user_department, user_department.c.org_unit_id == OrgUnit.id)
                .distinct()
                .order_by(OrgUnit.name.asc())
            ).all()
            if (name or "").strip()
        ]
        cost_centers = [
            code
            for code in self._db.scalars(
                select(CostCenterMaster.code)
                .join(user_cost_center, user_cost_center.c.cost_center_id == CostCenterMaster.id)
                .distinct()
                .order_by(CostCenterMaster.code.asc())
            ).all()
            if (code or "").strip()
        ]
        return {"plants": plants, "departments": departments, "cost_centers": cost_centers}

    def update_user(
        self,
        user_id: int,
        data: UserUpdate,
        *,
        actor_user_id: int | None = None,
    ) -> User:
        admin_before = count_users_with_admin_capability(self._db)
        user = self._db.scalar(
            select(User).where(User.id == user_id).options(*self._user_load_options())
        )
        if user is None:
            raise NotFoundError("User", user_id)
        if user.is_superuser:
            raise ValueError("Cannot modify superuser via admin user management")

        updates = data.model_dump(exclude_unset=True)

        before_snapshot = {
            "full_name": user.full_name,
            "username": user.username,
            "phone": user.phone,
            "email": user.email,
            "is_active": bool(user.is_active),
        }
        assignment_before = self._assignment_audit_fields(user)

        if "full_name" in updates and updates["full_name"] is not None:
            user.full_name = str(updates["full_name"]).strip()

        if "username" in updates and updates["username"] is not None:
            uname = str(updates["username"]).strip()
            if not uname:
                raise ValueError("Username is required")
            existing = self._db.scalar(select(User.id).where(User.username == uname, User.id != user.id))
            if existing is not None:
                raise DuplicateUsernameError
            user.username = uname

        if "phone" in updates and updates["phone"] is not None:
            phone = self._normalize_phone(str(updates["phone"]))
            existing = self._db.scalar(select(User.id).where(User.phone == phone, User.id != user.id))
            if existing is not None:
                raise DuplicatePhoneError
            user.phone = phone

        if "email" in updates:
            email_val = updates["email"]
            email_norm = email_val.lower().strip() if email_val is not None else None
            if email_norm:
                existing = self._db.scalar(
                    select(User.id).where(User.email == email_norm, User.id != user.id)
                )
                if existing is not None:
                    raise DuplicateEmailError
            user.email = email_norm

        # Password updates intentionally removed from admin UI flow.

        becoming_inactive = False
        if "is_active" in updates and updates["is_active"] is not None:
            next_active = bool(updates["is_active"])
            becoming_inactive = bool(user.is_active) and not next_active
            user.is_active = next_active
            if becoming_inactive:
                self._revoke_user_access(user.id)

        old_roles = list(user.roles or [])
        old_role_name = self._role_label(old_roles)
        role_changed = False
        next_role_ids = _role_ids_from_updates(updates)
        if next_role_ids is not None:
            roles = self._require_roles(next_role_ids)
            assert_self_role_update_keeps_users_view(
                self._db,
                actor_user_id=actor_user_id,
                target_user_id=user_id,
                new_role_ids=[int(r.id) for r in roles],
            )
            old_ids = sorted(int(r.id) for r in old_roles)
            if old_ids != sorted(int(r.id) for r in roles):
                role_changed = True
            user.roles = roles

        plant_ids: set[int] = {int(p.id) for p in (user.org_units or [])}
        plants_changed = False
        if "org_unit_ids" in updates and updates["org_unit_ids"] is not None:
            plants = self._require_plants(list(updates["org_unit_ids"]))
            user.org_units = plants
            plant_ids = {int(p.id) for p in plants}
            plants_changed = True

        if not plant_ids and (
            "department_ids" in updates or "cost_center_ids" in updates
        ):
            raise ValueError("Assign a plant before setting department or cost center")

        if "department_ids" in updates and updates["department_ids"] is not None:
            user.departments = self._resolve_departments(
                list(updates["department_ids"]), plant_ids=plant_ids
            )
        elif plants_changed:
            user.departments = [
                d
                for d in (user.departments or [])
                if d.parent_id is not None and int(d.parent_id) in plant_ids
            ]

        if "cost_center_ids" in updates and updates["cost_center_ids"] is not None:
            user.cost_centers = self._resolve_cost_centers(
                list(updates["cost_center_ids"]), plant_ids=plant_ids
            )
        elif plants_changed:
            user.cost_centers = [
                c for c in (user.cost_centers or []) if int(c.plant_id) in plant_ids
            ]

        self._db.flush()
        assert_did_not_remove_last_role_based_admin(
            self._db, admin_capable_users_before=admin_before
        )

        if role_changed:
            bump_user_permission_version(self._db, user_id)

        profile_keys = ("full_name", "username", "phone", "email", "is_active")
        profile_before = {k: before_snapshot[k] for k in profile_keys}
        profile_after = {
            "full_name": user.full_name,
            "username": user.username,
            "phone": user.phone,
            "email": user.email,
            "is_active": bool(user.is_active),
        }
        assignment_after = self._assignment_audit_fields(user)
        audit_old: dict[str, object] = {}
        audit_new: dict[str, object] = {}
        if role_changed:
            audit_old["role_name"] = old_role_name
            audit_new["role_name"] = self._role_label(list(user.roles or []))
        for key in profile_keys:
            if profile_before.get(key) != profile_after.get(key):
                audit_old[key] = profile_before[key]
                audit_new[key] = profile_after[key]
        for key in ("org_unit_name", "department_name", "cost_center_name"):
            if assignment_before.get(key) != assignment_after.get(key):
                audit_old[key] = assignment_before[key]
                audit_new[key] = assignment_after[key]
        if audit_old:
            action = "update"
            if set(audit_old.keys()) == {"is_active"}:
                if audit_old.get("is_active") is False and audit_new.get("is_active") is True:
                    action = "activate"
                elif audit_old.get("is_active") is True and audit_new.get("is_active") is False:
                    action = "deactivate"
            RbacAuditService(self._db).log(
                actor_user_id=actor_user_id,
                target_type="user",
                target_id=user_id,
                action=action,
                old_value=audit_old,
                new_value=audit_new,
            )

        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()
            raise DuplicatePhoneError from None

        uid = user.id
        self._db.expire_all()
        reloaded = self._db.scalar(
            select(User)
            .where(User.id == uid)
            .options(*self._user_load_options())
        )
        assert reloaded is not None

        after_snapshot = {
            "full_name": reloaded.full_name,
            "username": reloaded.username,
            "phone": reloaded.phone,
            "email": reloaded.email,
            "is_active": bool(reloaded.is_active),
        }
        changed = {k: after_snapshot[k] for k in after_snapshot.keys() if before_snapshot.get(k) != after_snapshot.get(k)}
        if changed:
            try:
                # If this user has an approval request in rework, attach the change audit to the open rework task.
                req = self._db.scalar(
                    select(ApprovalRequest)
                    .where(
                        ApprovalRequest.entity_type == "user_creation",
                        ApprovalRequest.entity_id == int(user_id),
                        ApprovalRequest.status.in_(("in_rework", "rejected")),
                    )
                    .order_by(ApprovalRequest.id.desc())
                    .limit(1)
                )
                if req is not None:
                    rework_task_id = self._db.scalar(
                        select(ApprovalTask.id).where(
                            ApprovalTask.request_id == req.id,
                            ApprovalTask.task_type == "rework",
                            ApprovalTask.status.in_(("open", "pending")),
                        )
                    )
                    if rework_task_id is not None:
                        self._db.add(
                            TaskAuditLog(
                                task_id=int(rework_task_id),
                                action="entity_updated",
                                actor_user_id=actor_user_id,
                                old_value=before_snapshot,
                                new_value=after_snapshot,
                            )
                        )
                        self._db.commit()

                    # Auto-resubmit when the submitter saves changes during rework.
                    if req.created_by is not None and actor_user_id is not None and int(req.created_by) == int(actor_user_id):
                        from modules.platform.approvals.service import ApprovalEngineService

                        ApprovalEngineService(self._db).resubmit_rejected_request(
                            request_id=int(req.id),
                            actor_user_id=int(actor_user_id),
                        )
            except Exception:
                self._db.rollback()
        return reloaded

    def assign_role(
        self,
        user_id: int,
        role_id: int,
        *,
        actor_user_id: int | None = None,
    ) -> None:
        user = self._db.get(User, user_id)
        if user is None:
            raise NotFoundError("User", user_id)
        role = self._db.get(Role, role_id)
        if role is None:
            raise NotFoundError("Role", role_id)
        if role in user.roles:
            return
        assert_self_role_assign_keeps_users_view(
            self._db,
            actor_user_id=actor_user_id,
            target_user_id=user_id,
            role_id=role_id,
        )
        old_ids = sorted({r.id for r in user.roles})
        user.roles.append(role)
        audit = RbacAuditService(self._db)
        audit.log(
            actor_user_id=actor_user_id,
            target_type="user",
            target_id=user_id,
            action="assign",
            old_value={"role_ids": old_ids},
            new_value={"role_ids": old_ids + [role_id]},
        )
        bump_user_permission_version(self._db, user_id)
        try:
            self._db.commit()
        except IntegrityError:
            self._db.rollback()

    def delete_user_permanently(
        self,
        user_id: int,
        *,
        actor_user_id: int | None = None,
    ) -> None:
        """
        Hard-delete a user and remove approval / unified-task data tied to that person.

        Superuser-only at the API layer. Blocks deleting the last superuser and the
        last role-based admin when no other superuser exists (see ``rbac_safety``).
        """
        if actor_user_id is not None and actor_user_id == user_id:
            raise ValueError("You cannot delete your own account from this screen.")

        admin_before = count_users_with_admin_capability(self._db)
        user = self._db.get(User, user_id)
        if user is None:
            raise NotFoundError("User", user_id)

        if user.is_superuser and count_superusers(self._db) <= 1:
            raise RbacSafetyError("Cannot delete the only remaining superuser account.")

        # Pending / historical approval for user onboarding (and any straggler same-entity requests).
        self._db.execute(
            delete(ApprovalRequest).where(
                ApprovalRequest.entity_type == "user_creation",
                ApprovalRequest.entity_id == user_id,
            )
        )

        # Unified / manual tasks that reference this user (tasks linked to requests were CASCADE-deleted).
        self._db.execute(
            delete(ApprovalTask).where(
                or_(
                    and_(ApprovalTask.entity_type == "user_creation", ApprovalTask.entity_id == user_id),
                    ApprovalTask.created_by == user_id,
                    ApprovalTask.assigned_to_user_id == user_id,
                    ApprovalTask.assigned_user_id == user_id,
                )
            )
        )

        # Do not pre-delete user_org_units rows: User.org_units is a secondary association and
        # SQLAlchemy will emit those deletes; pre-deleting causes StaleDataError ("expected 1 row").
        # Foreign keys on user_org_units.user_id use ON DELETE CASCADE, so the row vanishes with the user.
        self._db.delete(user)
        self._db.flush()
        try:
            assert_did_not_remove_last_role_based_admin(
                self._db, admin_capable_users_before=admin_before
            )
            self._db.commit()
        except RbacSafetyError:
            self._db.rollback()
            raise
        except IntegrityError:
            self._db.rollback()
            raise

        invalidate_permission_cache(user_id)

    def unlock_account(self, user_id: int, *, actor_user_id: int | None = None) -> dict[str, object]:
        """Clear a failed-login lock, set a temporary password, and email a reset link."""
        user = self._db.scalar(select(User).where(User.id == int(user_id)))
        if user is None:
            raise NotFoundError("User", user_id)
        if user.locked_at is None:
            raise ValueError("This account is not locked.")

        now = datetime.now(timezone.utc)
        plain = self._generate_password()
        user.locked_at = None
        user.failed_login_attempts = 0
        user.hashed_password = hash_password(plain)
        user.password_changed_at = now
        RbacAuditService(self._db).log(
            actor_user_id=actor_user_id,
            target_type="user",
            target_id=int(user.id),
            action="account_unlocked",
            old_value={"locked": True},
            new_value={"locked": False},
        )

        raw = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        expires_minutes = int((os.environ.get("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES") or "30").strip() or "30")
        if expires_minutes < 5:
            expires_minutes = 5
        self._db.add(
            PasswordResetToken(
                user_id=int(user.id),
                token_hash=token_hash,
                expires_at=now + timedelta(minutes=expires_minutes),
            )
        )
        self._db.commit()

        email = (user.email or "").strip()
        email_sent = False
        if email:
            base = (
                os.environ.get("FRONTEND_APP_URL")
                or os.environ.get("FRONTEND_ORIGIN")
                or "http://localhost:5173"
            ).rstrip("/")
            reset_link = f"{base}/reset-password?token={quote(raw, safe='')}"
            result = EmailNotificationService(self._db).trigger_event(
                event_code="ACCOUNT_UNLOCKED",
                payload={
                    "user_name": user.full_name,
                    "email": email,
                    "company_name": "Takeda Asset Management",
                    "temp_password": plain,
                    "reset_link": reset_link,
                },
            )
            email_sent = result.status == "sent"

        return {"email_sent": email_sent}

    def resend_mfa_setup_email(self, user_id: int) -> None:
        from modules.platform.auth.notify import trigger_mfa_setup_email, user_has_pending_user_creation_approval

        user = self._db.scalar(
            select(User)
            .where(User.id == int(user_id))
            .options(*self._user_load_options())
        )
        if user is None:
            raise NotFoundError("User", user_id)
        if not user.is_active:
            raise ValueError("User is not active")
        if user.is_superuser:
            raise ValueError("Not applicable for superuser")
        pol = get_global_policy(self._db)
        if not bool(pol.mfa_enabled):
            raise ValueError("MFA is not enabled")
        if user.mfa_record is not None and bool(user.mfa_record.setup_completed):
            raise ValueError("MFA is already set up")
        if user_has_pending_user_creation_approval(self._db, int(user.id)):
            raise ValueError("User creation approval is still pending")
        trigger_mfa_setup_email(self._db, user, "MFA_SETUP_REMINDER")

    def resend_welcome_email(self, user_id: int) -> None:
        """
        Re-send the final welcome email (USER_CREATED) for an already-approved user.

        Includes:
        - temp password if stored on the last user_creation approval payload (when auto-generated)
        - MFA setup link when policy requires MFA and setup isn't complete
        """
        user = self._db.scalar(
            select(User)
            .where(User.id == int(user_id))
            .options(*self._user_load_options())
        )
        if user is None:
            raise NotFoundError("User", user_id)
        if not user.is_active:
            raise ValueError("User is not active")
        if user.is_superuser:
            raise ValueError("Not applicable for superuser")
        if not user.email:
            raise ValueError("User has no email address")

        payload: dict[str, object] = {
            "user_name": user.full_name,
            "username": user.username,
            "email": user.email,
            "company_name": "Takeda Asset Management",
            # keep template variables always present
            "temp_password": "",
            "setup_link": "",
        }

        # Pull temp_password from latest user_creation approval request if available.
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(
                ApprovalRequest.entity_type == "user_creation",
                ApprovalRequest.entity_id == int(user.id),
            )
            .order_by(ApprovalRequest.id.desc())
            .limit(1)
        )
        if req is not None and isinstance(req.payload, dict):
            raw = req.payload.get("temp_password")
            if isinstance(raw, str) and raw.strip():
                payload["temp_password"] = raw.strip()
        # If we no longer have the original temp password (common after older records or manual edits),
        # generate a new temporary password, update the user's credential, and send that.
        if not str(payload.get("temp_password") or "").strip():
            plain = self._generate_password()
            validate_password(plain)
            user.hashed_password = hash_password(plain)
            user.password_changed_at = datetime.now(timezone.utc)
            # Best-effort: keep it on the latest request payload too, so subsequent resends are stable.
            if req is not None and isinstance(req.payload, dict):
                req.payload["temp_password"] = plain
            self._db.commit()
            payload["temp_password"] = plain

        # If MFA is enabled and not completed, include a fresh setup link.
        try:
            pol = get_global_policy(self._db)
            if bool(pol.mfa_enabled) and (user.mfa_record is None or not bool(user.mfa_record.setup_completed)):
                link = create_mfa_setup_link(self._db, user=user)
                if link:
                    payload["setup_link"] = link
        except Exception:
            pass

        enqueue_trigger_events([("USER_CREATED", payload)])  # type: ignore[arg-type]
