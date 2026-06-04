from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.model import ApprovalTask, TaskAuditLog
from modules.platform.approvals.service import ApprovalEngineService
from modules.assets.lifecycle import (
    APPROVAL_DRAFT,
    APPROVAL_PENDING,
    APPROVAL_REJECTED,
    LIFECYCLE_ACTIVE,
    LIFECYCLE_INACTIVE,
    LIFECYCLE_PENDING_LEGACY,
    action_codes_for_asset,
    asset_approval_payload,
    can_submit_for_approval,
    find_open_asset_approval_request,
    find_pending_asset_approval_request,
    is_awaiting_approval,
    set_asset_active_immediate,
    set_asset_approved_active,
    set_asset_inactive_draft,
    set_asset_pending_approval,
    set_asset_rejected_inactive,
)
from modules.assets.audit_helpers import (
    ORDER_ASSET_AUDIT_ACTIONS,
    include_asset_audit_event,
    actor_display,
    activity_verb_for_action,
    build_audit_summary,
    diff_snapshots,
    format_asset_order_audit_lines,
    format_changes_detail,
    snapshot_asset,
)
from modules.assets.audit_log import log_asset_event
from modules.assets.model import AssetAuditEvent
from modules.assets.import_parser import parse_upload_file
from modules.assets.import_row_mapper import build_section_payloads
from modules.assets.import_validation import (
    apply_import_validation,
    build_preview_response,
    rows_from_raw_dicts,
)
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    TagColorMaster,
)
from modules.assets.model import (
    AssetCategory,
    AssetFinancialInformation,
    AssetImportBatch,
    AssetInformation,
    AssetInventoryInformation,
    AssetLocationInformation,
    AssetMaster,
)
from modules.assets.schema import (
    AssetCreateRequest,
    AssetDetailPublic,
    AssetFinancialPayload,
    AssetInformationPayload,
    AssetInventoryPayload,
    AssetListItem,
    AssetListResponse,
    AssetLocationPayload,
    AssetUpdateRequest,
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportPreviewResponse,
    SubmitForApprovalResponse,
)
from modules.errors import ConflictError, NotFoundError
from modules.platform.org_units.model import OrgUnit


class DuplicateAssetCodeError(Exception):
    pass


class DuplicateRfidError(Exception):
    """RFID is already assigned to another asset."""

    def __init__(
        self,
        *,
        rfid_code: str,
        existing_asset_id: int,
        existing_asset_code: str,
    ) -> None:
        self.rfid_code = rfid_code
        self.existing_asset_id = existing_asset_id
        self.existing_asset_code = existing_asset_code
        self.message = (
            f"RFID code '{rfid_code}' is already assigned to asset "
            f"{existing_asset_code} (id {existing_asset_id})."
        )
        super().__init__(self.message)


class InvalidRfidError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class InvalidTagColorError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _normalize_rfid(raw: str) -> str:
    return (raw or "").strip()


def _assert_rfid_available(
    db: Session,
    *,
    rfid: str,
    exclude_asset_id: int | None,
) -> None:
    stmt = select(AssetMaster.id, AssetMaster.asset_code).where(
        AssetMaster.rfid_code == rfid,
        AssetMaster.deleted_at.is_(None),
    )
    if exclude_asset_id is not None:
        stmt = stmt.where(AssetMaster.id != exclude_asset_id)
    row = db.execute(stmt).first()
    if row is not None:
        raise DuplicateRfidError(
            rfid_code=rfid,
            existing_asset_id=int(row[0]),
            existing_asset_code=str(row[1]),
        )


class ImportValidationError(Exception):
    def __init__(self, preview: ImportPreviewResponse) -> None:
        self.preview = preview
        super().__init__("Import validation failed")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _apply_information(asset_id: int, payload: AssetInformationPayload | None) -> AssetInformation:
    info = AssetInformation(asset_id=asset_id)
    if payload:
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(info, k, v)
    return info


def _apply_location(asset_id: int, payload: AssetLocationPayload | None) -> AssetLocationInformation:
    loc = AssetLocationInformation(asset_id=asset_id)
    if payload:
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(loc, k, v)
    return loc


def _apply_financial(asset_id: int, payload: AssetFinancialPayload | None) -> AssetFinancialInformation:
    fin = AssetFinancialInformation(asset_id=asset_id)
    if payload:
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(fin, k, v)
    return fin


INVENTORY_READONLY_FIELDS = frozenset(
    {"inventory_count", "physical_count", "last_verification_date"}
)


def _new_inventory_row(asset_id: int) -> AssetInventoryInformation:
    return AssetInventoryInformation(
        asset_id=asset_id,
        inventory_count=1,
        physical_count=0,
        last_verification_date=None,
        verification_status=None,
        verification_remarks=None,
    )


def _apply_inventory(asset_id: int, payload: AssetInventoryPayload | None) -> AssetInventoryInformation:
    inv = _new_inventory_row(asset_id)
    if payload:
        for k, v in payload.model_dump(exclude_unset=True).items():
            if k in INVENTORY_READONLY_FIELDS:
                continue
            setattr(inv, k, v)
    return inv


def _merge_inventory_update(
    row: AssetInventoryInformation, payload: AssetInventoryPayload
) -> None:
    for k, v in payload.model_dump(exclude_unset=True).items():
        if k in INVENTORY_READONLY_FIELDS:
            continue
        setattr(row, k, v)


class AssetMasterService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_categories(self) -> list[AssetCategory]:
        return list(
            self._db.scalars(
                select(AssetCategory).where(AssetCategory.is_active.is_(True)).order_by(AssetCategory.name)
            ).all()
        )

    def _resolve_category_id(self, *, category_id: int | None, category_code: str | None) -> int | None:
        if category_id is not None:
            if self._db.get(AssetCategory, category_id) is None:
                raise NotFoundError("AssetCategory", category_id)
            return category_id
        if category_code:
            cat = self._db.scalar(
                select(AssetCategory).where(func.lower(AssetCategory.code) == category_code.strip().lower())
            )
            return int(cat.id) if cat else None
        return None

    def _resolve_tag_color_id(
        self, *, tag_color_id: int | None, tag_color_code: str | None
    ) -> int | None:
        if tag_color_id is not None:
            row = self._db.get(TagColorMaster, tag_color_id)
            if row is None or not row.is_active:
                raise InvalidTagColorError("Unknown or inactive tag color.")
            return int(row.id)
        if tag_color_code:
            row = self._db.scalar(
                select(TagColorMaster).where(
                    func.lower(TagColorMaster.code) == tag_color_code.strip().lower(),
                    TagColorMaster.is_active.is_(True),
                )
            )
            if row is None:
                raise InvalidTagColorError("Unknown tag color code.")
            return int(row.id)
        return None

    def _set_tag_color(self, asset: AssetMaster, tag_color_id: int | None) -> None:
        rfid = _normalize_rfid(asset.rfid_code or "")
        if tag_color_id is not None:
            if not rfid:
                raise InvalidTagColorError("Tag color is only allowed when an RFID code is provided.")
            row = self._db.get(TagColorMaster, tag_color_id)
            if row is None or not row.is_active:
                raise InvalidTagColorError("Unknown or inactive tag color.")
            asset.tag_color_id = int(tag_color_id)
        else:
            asset.tag_color_id = None

    def _resolve_plant_id(self, plant_code: str | None, plant_id: int | None) -> int | None:
        if plant_id is not None:
            org = self._db.get(OrgUnit, plant_id)
            if org is None:
                raise NotFoundError("OrgUnit", plant_id)
            return plant_id
        if plant_code:
            org = self._db.scalar(
                select(OrgUnit).where(
                    func.lower(OrgUnit.code) == plant_code.strip().lower(),
                    OrgUnit.type == "PLANT",
                )
            )
            return int(org.id) if org else None
        return None

    def _submit_one_asset_for_approval(
        self, asset: AssetMaster, *, actor_user_id: int | None
    ) -> str:
        """
        Send one asset into approval. Returns ``submitted`` (workflow tasks created) or
        ``activated`` (no workflow configured — immediately active).
        """
        if not can_submit_for_approval(asset):
            raise ConflictError(
                f"Asset {asset.asset_code} cannot be submitted "
                f"(status: {asset.lifecycle_status} / {asset.approval_status})."
            )

        if find_pending_asset_approval_request(self._db, asset_id=int(asset.id)) is not None:
            raise ConflictError(f"Asset {asset.asset_code} is already pending approval.")

        action_code, entity_type = action_codes_for_asset(asset)

        if (asset.approval_status or "").strip().lower() == APPROVAL_REJECTED:
            req = find_open_asset_approval_request(self._db, asset_id=int(asset.id))
            if req is None:
                raise ConflictError(
                    f"Asset {asset.asset_code} was rejected but has no approval request to resubmit."
                )
            if actor_user_id is None:
                raise ConflictError("Authentication required to resubmit for approval.")
            ApprovalEngineService(self._db).resubmit_rejected_request(
                request_id=int(req.id),
                actor_user_id=int(actor_user_id),
            )
            set_asset_pending_approval(asset)
            log_asset_event(
                self._db,
                asset_id=asset.id,
                actor_user_id=actor_user_id,
                action="submitted_for_approval",
                new_value={
                    "action_code": action_code,
                    "resubmit": True,
                    "lifecycle_status": asset.lifecycle_status,
                    "approval_status": asset.approval_status,
                },
            )
            return "submitted"

        extra: dict[str, Any] | None = None
        if entity_type == "asset_import" and asset.import_batch_id is not None:
            extra = {"batch_id": int(asset.import_batch_id)}

        wf = get_workflow_for_action(self._db, action_code)
        if wf is None:
            before = {
                "lifecycle_status": asset.lifecycle_status,
                "approval_status": asset.approval_status,
            }
            set_asset_active_immediate(asset)
            log_asset_event(
                self._db,
                asset_id=asset.id,
                actor_user_id=actor_user_id,
                action="activated",
                old_value=before,
                new_value={
                    "lifecycle_status": asset.lifecycle_status,
                    "approval_status": asset.approval_status,
                    "note": "No approval workflow configured",
                },
            )
            return "activated"

        set_asset_pending_approval(asset)
        payload = asset_approval_payload(asset, action_code=action_code, extra=extra)
        ApprovalEngineService(self._db).create_request_for_entity(
            workflow=wf,
            entity_type=entity_type,
            entity_id=asset.id,
            payload=payload,
            created_by=actor_user_id,
        )
        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="submitted_for_approval",
            new_value={
                "action_code": action_code,
                "lifecycle_status": asset.lifecycle_status,
                "approval_status": asset.approval_status,
            },
        )
        return "submitted"

    def submit_for_approval(
        self, asset_ids: list[int], *, actor_user_id: int | None
    ) -> SubmitForApprovalResponse:
        submitted_count = 0
        activated_count = 0
        errors: list[str] = []
        seen: set[int] = set()
        for raw_id in asset_ids:
            aid = int(raw_id)
            if aid in seen:
                continue
            seen.add(aid)
            try:
                asset = self._load_asset(aid)
                outcome = self._submit_one_asset_for_approval(asset, actor_user_id=actor_user_id)
                if outcome == "submitted":
                    submitted_count += 1
                else:
                    activated_count += 1
            except NotFoundError:
                errors.append(f"Asset #{aid}: not found.")
            except ConflictError as exc:
                errors.append(str(exc))
            except Exception as exc:
                errors.append(f"Asset #{aid}: {exc}")
        if submitted_count or activated_count:
            try:
                self._db.commit()
            except Exception as exc:
                self._db.rollback()
                raise ConflictError(f"Submit for approval failed: {exc}") from exc
        elif errors:
            self._db.rollback()
        return SubmitForApprovalResponse(
            submitted_count=submitted_count,
            activated_count=activated_count,
            errors=errors,
        )

    def create_asset(
        self, data: AssetCreateRequest, *, actor_user_id: int | None
    ) -> AssetDetailPublic:
        code = data.asset_code.strip().upper()
        if self._db.scalar(select(AssetMaster.id).where(AssetMaster.asset_code == code, AssetMaster.deleted_at.is_(None))):
            raise DuplicateAssetCodeError()
        if data.rfid_code:
            rfid = _normalize_rfid(data.rfid_code)
            if rfid:
                _assert_rfid_available(self._db, rfid=rfid, exclude_asset_id=None)

        asset = AssetMaster(
            asset_name=data.asset_name.strip(),
            asset_code=code,
            rfid_code=data.rfid_code.strip() if data.rfid_code else None,
            serial_no=data.serial_no.strip() if data.serial_no else None,
            asset_category_id=data.asset_category_id,
            asset_class=data.asset_class.strip() if data.asset_class else None,
            asset_type=data.asset_type.strip() if data.asset_type else None,
            ownership_type=data.ownership_type,
            source_type="manual",
            created_by=actor_user_id,
        )
        set_asset_inactive_draft(asset)
        self._db.add(asset)
        self._db.flush()

        self._db.add(_apply_information(asset.id, data.information))
        loc_payload = data.location
        if loc_payload and loc_payload.plant_id:
            self._resolve_plant_id(None, loc_payload.plant_id)
        self._db.add(_apply_location(asset.id, data.location))
        self._db.add(_apply_financial(asset.id, data.financial))
        self._db.add(_apply_inventory(asset.id, data.inventory))
        if data.tag_color_id is not None:
            self._set_tag_color(asset, data.tag_color_id)

        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="created",
            new_value={
                "source": "manual",
                "asset_code": code,
                "lifecycle_status": asset.lifecycle_status,
                "approval_status": asset.approval_status,
            },
        )
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            if "rfid" in str(exc).lower():
                raise DuplicateRfidError() from exc
            raise DuplicateAssetCodeError() from exc
        return self.get_asset(asset.id)

    def _master_label_lookups(
        self, rows: list[AssetMaster]
    ) -> tuple[
        dict[tuple[int, str], str],
        dict[tuple[int, str], str],
        dict[tuple[int, str, str], str],
    ]:
        """Resolve cost center, functional, and actual location descriptions from reference masters."""
        plant_ids: set[int] = set()
        for a in rows:
            loc = a.location
            if loc and loc.plant_id:
                plant_ids.add(int(loc.plant_id))
        if not plant_ids:
            return {}, {}, {}

        cc_rows = self._db.scalars(
            select(CostCenterMaster).where(CostCenterMaster.plant_id.in_(plant_ids))
        ).all()
        cc_desc: dict[tuple[int, str], str] = {
            (int(r.plant_id), str(r.code)): str(r.description) for r in cc_rows
        }

        fl_rows = self._db.scalars(
            select(FunctionalLocationMaster).where(FunctionalLocationMaster.plant_id.in_(plant_ids))
        ).all()
        fl_desc: dict[tuple[int, str], str] = {
            (int(r.plant_id), str(r.code)): str(r.description) for r in fl_rows
        }
        fl_id_to_key: dict[int, tuple[int, str]] = {
            int(r.id): (int(r.plant_id), str(r.code)) for r in fl_rows
        }

        al_desc: dict[tuple[int, str, str], str] = {}
        if fl_id_to_key:
            al_rows = self._db.scalars(
                select(ActualLocationMaster).where(
                    ActualLocationMaster.functional_location_id.in_(fl_id_to_key.keys())
                )
            ).all()
            for al in al_rows:
                parent = fl_id_to_key.get(int(al.functional_location_id))
                if parent is None:
                    continue
                plant_id, fl_code = parent
                al_desc[(plant_id, fl_code, str(al.code))] = str(al.description)

        return cc_desc, fl_desc, al_desc

    def list_assets(
        self,
        *,
        page: int = 1,
        page_size: int = 25,
        search: str | None = None,
        plant_id: int | None = None,
        category_id: int | None = None,
        lifecycle_status: str | None = None,
        approval_status: str | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
    ) -> AssetListResponse:
        page = max(1, page)
        page_size = min(max(1, page_size), 100)
        base = (
            select(AssetMaster)
            .where(AssetMaster.deleted_at.is_(None))
            .options(
                selectinload(AssetMaster.category),
                selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
                selectinload(AssetMaster.financial),
                selectinload(AssetMaster.inventory),
            )
        )
        if search:
            q = f"%{search.strip()}%"
            base = base.where(
                or_(
                    AssetMaster.asset_name.ilike(q),
                    AssetMaster.asset_code.ilike(q),
                    AssetMaster.serial_no.ilike(q),
                    AssetMaster.rfid_code.ilike(q),
                )
            )
        if category_id is not None:
            base = base.where(AssetMaster.asset_category_id == category_id)
        if lifecycle_status:
            ls = lifecycle_status.strip().lower()
            if ls == LIFECYCLE_INACTIVE:
                from modules.assets.lifecycle import LIFECYCLE_PENDING_LEGACY

                base = base.where(
                    AssetMaster.lifecycle_status.in_((LIFECYCLE_INACTIVE, LIFECYCLE_PENDING_LEGACY))
                )
            else:
                base = base.where(AssetMaster.lifecycle_status == lifecycle_status)
        if approval_status:
            base = base.where(AssetMaster.approval_status == approval_status)
        if plant_id is not None:
            base = base.join(AssetLocationInformation).where(AssetLocationInformation.plant_id == plant_id)

        count_stmt = select(func.count()).select_from(base.subquery())
        total = int(self._db.scalar(count_stmt) or 0)

        order_col = AssetMaster.created_at
        if sort_by == "asset_name":
            order_col = AssetMaster.asset_name
        elif sort_by == "asset_code":
            order_col = AssetMaster.asset_code
        if sort_dir.lower() == "asc":
            base = base.order_by(order_col.asc())
        else:
            base = base.order_by(order_col.desc())

        rows = list(
            self._db.scalars(base.offset((page - 1) * page_size).limit(page_size)).unique().all()
        )
        cc_desc, fl_desc, al_desc = self._master_label_lookups(rows)
        items: list[AssetListItem] = []
        for a in rows:
            loc = a.location
            fin = a.financial
            inv = a.inventory
            pid = int(loc.plant_id) if loc and loc.plant_id else None
            fl_code = (loc.functional_location or "").strip() if loc else ""
            al_code = (loc.actual_location or "").strip() if loc else ""
            cc_code = (fin.cost_center or "").strip() if fin else ""
            fl_description = fl_desc.get((pid, fl_code)) if pid and fl_code else None
            al_description = al_desc.get((pid, fl_code, al_code)) if pid and fl_code and al_code else None
            cc_description = cc_desc.get((pid, cc_code)) if pid and cc_code else None
            items.append(
                AssetListItem(
                    id=a.id,
                    asset_name=a.asset_name,
                    asset_code=a.asset_code,
                    rfid_code=a.rfid_code,
                    category_name=a.category.name if a.category else None,
                    plant_id=pid,
                    plant_code=loc.plant.code if loc and loc.plant else None,
                    plant_name=loc.plant.name if loc and loc.plant else None,
                    functional_location=fl_code or None,
                    functional_location_description=fl_description,
                    actual_location=al_code or None,
                    actual_location_description=al_description,
                    cost_center=cc_code or None,
                    cost_center_description=cc_description,
                    inventory_count=inv.inventory_count if inv else None,
                    physical_count=inv.physical_count if inv else None,
                    last_verification_date=inv.last_verification_date if inv else None,
                    lifecycle_status=a.lifecycle_status,
                    approval_status=a.approval_status,
                    source_type=a.source_type,
                    created_at=a.created_at,
                )
            )
        return AssetListResponse(items=items, total=total, page=page, page_size=page_size)

    def get_asset(self, asset_id: int) -> AssetDetailPublic:
        asset = self._load_asset(asset_id)
        return self._to_detail(asset)

    def _load_asset(self, asset_id: int) -> AssetMaster:
        asset = self._db.scalar(
            select(AssetMaster)
            .where(AssetMaster.id == asset_id, AssetMaster.deleted_at.is_(None))
            .options(
                selectinload(AssetMaster.category),
                selectinload(AssetMaster.tag_color),
                selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
                selectinload(AssetMaster.information),
                selectinload(AssetMaster.financial),
                selectinload(AssetMaster.inventory),
            )
        )
        if asset is None:
            raise NotFoundError("Asset", asset_id)
        return asset

    def _to_detail(self, asset: AssetMaster) -> AssetDetailPublic:
        info = asset.information
        loc = asset.location
        fin = asset.financial
        inv = asset.inventory
        return AssetDetailPublic(
            id=asset.id,
            asset_name=asset.asset_name,
            asset_code=asset.asset_code,
            rfid_code=asset.rfid_code,
            serial_no=asset.serial_no,
            asset_category_id=asset.asset_category_id,
            asset_class=asset.asset_class,
            asset_type=asset.asset_type,
            category_name=asset.category.name if asset.category else None,
            tag_color_id=asset.tag_color_id,
            tag_color_code=asset.tag_color.code if asset.tag_color else None,
            tag_color_name=asset.tag_color.name if asset.tag_color else None,
            tag_color_hex=asset.tag_color.color_hex if asset.tag_color else None,
            lifecycle_status=asset.lifecycle_status,
            approval_status=asset.approval_status,
            ownership_type=asset.ownership_type,
            source_type=asset.source_type,
            import_batch_id=asset.import_batch_id,
            created_by=asset.created_by,
            approved_by=asset.approved_by,
            created_at=asset.created_at,
            updated_at=asset.updated_at,
            plant_name=loc.plant.name if loc and loc.plant else None,
            information=AssetInformationPayload.model_validate(info) if info else None,
            location=AssetLocationPayload.model_validate(loc) if loc else None,
            financial=AssetFinancialPayload.model_validate(fin) if fin else None,
            inventory=AssetInventoryPayload.model_validate(inv) if inv else None,
        )

    def attach_rfid(
        self,
        asset_id: int,
        rfid_code: str,
        *,
        tag_color_id: int | None = None,
        actor_user_id: int,
    ):
        """Attach or replace RFID on an asset. RFID must be unique across active assets."""
        from modules.assets.schema import AssetRfidAttachPublic

        asset = self._load_asset(asset_id)
        rfid = _normalize_rfid(rfid_code)
        if not rfid:
            raise InvalidRfidError("RFID code is required.")
        if len(rfid) > 128:
            raise InvalidRfidError("RFID code must be at most 128 characters.")

        _assert_rfid_available(self._db, rfid=rfid, exclude_asset_id=asset_id)

        before = snapshot_asset(asset)
        previous = (asset.rfid_code or "").strip() or None
        had_rfid = bool(previous)
        asset.rfid_code = rfid
        if tag_color_id is not None:
            self._set_tag_color(asset, tag_color_id)
        asset.updated_at = _now()
        self._db.flush()

        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="rfid_updated" if had_rfid else "rfid_attached",
            old_value=before,
            new_value={"rfid_code": rfid, "tag_color_id": asset.tag_color_id},
        )
        self._db.commit()
        asset = self._load_asset(asset.id)
        operation = "updated" if had_rfid else "attached"
        return AssetRfidAttachPublic(
            asset_id=int(asset.id),
            asset_code=asset.asset_code,
            asset_name=asset.asset_name,
            rfid_code=rfid,
            previous_rfid_code=previous,
            operation=operation,
            tag_color_id=asset.tag_color_id,
            tag_color_code=asset.tag_color.code if asset.tag_color else None,
            tag_color_name=asset.tag_color.name if asset.tag_color else None,
            tag_color_hex=asset.tag_color.color_hex if asset.tag_color else None,
        )

    def attach_rfid_by_asset_code(
        self,
        asset_code: str,
        rfid_code: str,
        *,
        tag_color_id: int | None = None,
        actor_user_id: int,
    ):
        """Attach RFID using asset code (list toolbar / scan workflow)."""
        code = asset_code.strip().upper()
        if not code:
            raise InvalidRfidError("Asset code is required.")
        asset_id = self._db.scalar(
            select(AssetMaster.id).where(
                AssetMaster.asset_code == code,
                AssetMaster.deleted_at.is_(None),
            )
        )
        if asset_id is None:
            raise NotFoundError("Asset", code)
        return self.attach_rfid(
            int(asset_id),
            rfid_code,
            tag_color_id=tag_color_id,
            actor_user_id=actor_user_id,
        )

    def update_rfid(
        self,
        asset_id: int,
        rfid_code: str,
        *,
        actor_user_id: int,
    ) -> AssetDetailPublic:
        """Backward-compatible alias; returns full asset detail after attach."""
        self.attach_rfid(asset_id, rfid_code, actor_user_id=actor_user_id)
        return self.get_asset(asset_id)

    def update_asset(
        self, asset_id: int, data: AssetUpdateRequest, *, actor_user_id: int | None
    ) -> AssetDetailPublic:
        asset = self._load_asset(asset_id)
        if (asset.approval_status or "").strip().lower() == APPROVAL_PENDING:
            raise ConflictError("Cannot edit asset while approval is pending.")

        before = snapshot_asset(asset)
        if data.asset_name is not None:
            asset.asset_name = data.asset_name.strip()
        if data.asset_code is not None:
            code = data.asset_code.strip().upper()
            if self._db.scalar(
                select(AssetMaster.id).where(
                    AssetMaster.asset_code == code,
                    AssetMaster.id != asset.id,
                    AssetMaster.deleted_at.is_(None),
                )
            ):
                raise DuplicateAssetCodeError()
            asset.asset_code = code
        if data.rfid_code is not None:
            rfid = _normalize_rfid(data.rfid_code) or None
            if rfid:
                _assert_rfid_available(self._db, rfid=rfid, exclude_asset_id=asset.id)
            asset.rfid_code = rfid
            if not rfid:
                asset.tag_color_id = None
        if "tag_color_id" in data.model_dump(exclude_unset=True):
            self._set_tag_color(asset, data.tag_color_id)
        if data.serial_no is not None:
            asset.serial_no = data.serial_no.strip() or None
        if data.asset_category_id is not None:
            asset.asset_category_id = data.asset_category_id
        if data.asset_class is not None:
            asset.asset_class = data.asset_class.strip() or None
        if data.asset_type is not None:
            asset.asset_type = data.asset_type.strip() or None
        if data.ownership_type is not None:
            asset.ownership_type = data.ownership_type
        if data.information is not None:
            if asset.information is None:
                asset.information = _apply_information(asset.id, data.information)
                self._db.add(asset.information)
            else:
                for k, v in data.information.model_dump(exclude_unset=True).items():
                    setattr(asset.information, k, v)
        if data.location is not None:
            if data.location.plant_id is not None:
                self._resolve_plant_id(None, data.location.plant_id)
            if asset.location is None:
                asset.location = _apply_location(asset.id, data.location)
                self._db.add(asset.location)
            else:
                for k, v in data.location.model_dump(exclude_unset=True).items():
                    setattr(asset.location, k, v)
        if data.financial is not None:
            if asset.financial is None:
                asset.financial = _apply_financial(asset.id, data.financial)
                self._db.add(asset.financial)
            else:
                for k, v in data.financial.model_dump(exclude_unset=True).items():
                    setattr(asset.financial, k, v)
        if data.inventory is not None:
            if asset.inventory is None:
                asset.inventory = _apply_inventory(asset.id, data.inventory)
                self._db.add(asset.inventory)
            else:
                _merge_inventory_update(asset.inventory, data.inventory)

        asset.updated_at = _now()
        self._db.flush()
        changes = diff_snapshots(before, snapshot_asset(asset))
        if changes:
            log_asset_event(
                self._db,
                asset_id=asset.id,
                actor_user_id=actor_user_id,
                action="updated",
                old_value=before,
                new_value={"changes": changes},
            )
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            if "rfid" in str(exc).lower():
                raise DuplicateRfidError() from exc
            raise DuplicateAssetCodeError() from exc

        self._maybe_auto_resubmit_asset_after_update(
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            before_snapshot=before,
            after_asset=self._load_asset(asset.id),
        )
        return self.get_asset(asset.id)

    def _maybe_auto_resubmit_asset_after_update(
        self,
        *,
        asset_id: int,
        actor_user_id: int | None,
        before_snapshot: dict[str, Any],
        after_asset: AssetMaster,
    ) -> None:
        """Mirror user-creation rework: log task changes and resubmit when the creator saves edits."""
        if actor_user_id is None:
            return
        after_snapshot = snapshot_asset(after_asset)
        if not diff_snapshots(before_snapshot, after_snapshot):
            return
        req = find_open_asset_approval_request(self._db, asset_id=asset_id)
        if req is None or req.created_by is None:
            return
        if int(req.created_by) != int(actor_user_id):
            return
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
        try:
            ApprovalEngineService(self._db).resubmit_rejected_request(
                request_id=int(req.id),
                actor_user_id=int(actor_user_id),
            )
        except Exception:
            self._db.rollback()

    def soft_delete(self, asset_id: int, *, actor_user_id: int | None) -> None:
        asset = self._load_asset(asset_id)
        asset.deleted_at = _now()
        asset.lifecycle_status = LIFECYCLE_INACTIVE
        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="deleted",
            new_value={"lifecycle_status": LIFECYCLE_INACTIVE},
        )
        self._db.commit()

    def list_audit(self, asset_id: int) -> list:
        from modules.assets.schema import AssetAuditChangeLine, AssetAuditEventPublic
        from modules.platform.users.model import User

        asset = self._load_asset(asset_id)
        events = list(
            self._db.scalars(
                select(AssetAuditEvent)
                .where(AssetAuditEvent.asset_id == asset_id)
                .order_by(AssetAuditEvent.created_at.desc())
            ).all()
        )
        actor_ids = {e.actor_user_id for e in events if e.actor_user_id is not None}
        users_by_id: dict[int, User] = {}
        if actor_ids:
            users = list(self._db.scalars(select(User).where(User.id.in_(actor_ids))).all())
            users_by_id = {int(u.id): u for u in users}

        plants = list(self._db.scalars(select(OrgUnit).where(OrgUnit.type == "PLANT")).all())
        plant_labels = {int(p.id): f"{p.code} — {p.name}" for p in plants}
        categories = list(self._db.scalars(select(AssetCategory)).all())
        category_labels = {int(c.id): f"{c.code} — {c.name}" for c in categories}

        out: list[AssetAuditEventPublic] = []
        for ev in events:
            if not include_asset_audit_event(ev.action):
                continue
            actor = users_by_id.get(int(ev.actor_user_id)) if ev.actor_user_id else None
            name = actor_display(actor, ev.actor_user_id)
            change_rows: list[AssetAuditChangeLine] = []
            nv = ev.new_value if isinstance(ev.new_value, dict) else {}
            ov = ev.old_value if isinstance(ev.old_value, dict) else {}
            if ev.action == "updated" and isinstance(nv.get("changes"), dict):
                change_rows = [
                    AssetAuditChangeLine(**line)
                    for line in format_changes_detail(
                        nv["changes"],
                        plant_labels=plant_labels,
                        category_labels=category_labels,
                    )
                ]
            elif ev.action in ORDER_ASSET_AUDIT_ACTIONS:
                change_rows = [
                    AssetAuditChangeLine(**line)
                    for line in format_asset_order_audit_lines(
                        ev.action,
                        old_value=ov,
                        new_value=nv,
                    )
                ]
            summary = build_audit_summary(
                action=ev.action,
                actor_name=name,
                new_value=ev.new_value,
                old_value=ev.old_value,
                source_type=asset.source_type,
                plant_labels=plant_labels,
                category_labels=category_labels,
            )
            out.append(
                AssetAuditEventPublic(
                    id=ev.id,
                    action=ev.action,
                    actor_user_id=ev.actor_user_id,
                    actor_name=name if ev.actor_user_id or actor else None,
                    activity_verb=activity_verb_for_action(
                        ev.action, nv, asset.source_type
                    ),
                    summary=summary,
                    changes=change_rows,
                    created_at=ev.created_at,
                )
            )
        return out

    def preview_import(self, *, filename: str | None, content: bytes) -> ImportPreviewResponse:
        rows = apply_import_validation(self._db, parse_upload_file(filename=filename, content=content))
        return ImportPreviewResponse(**build_preview_response(filename=filename, rows=rows))

    def validate_import_rows(
        self, *, filename: str | None, raw_rows: list[dict[str, Any]]
    ) -> ImportPreviewResponse:
        rows = apply_import_validation(self._db, rows_from_raw_dicts(raw_rows))
        return ImportPreviewResponse(**build_preview_response(filename=filename, rows=rows))

    def confirm_import(
        self, body: ImportConfirmRequest, *, actor_user_id: int | None
    ) -> ImportConfirmResponse:
        validated = self.validate_import_rows(filename=body.filename, raw_rows=body.rows)
        invalid = [r for r in validated.rows if not r.valid]
        if invalid:
            raise ImportValidationError(validated)

        batch = AssetImportBatch(
            filename=body.filename,
            total_rows=len(body.rows),
            status="processing",
            created_by=actor_user_id,
        )
        self._db.add(batch)
        self._db.flush()

        created = 0
        errors: list[str] = []

        for idx, raw in enumerate(validated.rows, start=1):
            try:
                mapped = build_section_payloads(raw.data)
                code = mapped.get("asset_code") or ""
                name = mapped.get("asset_name") or ""
                rfid = mapped.get("rfid_code")
                if rfid:
                    if self._db.scalar(
                        select(AssetMaster.id).where(
                            AssetMaster.rfid_code == rfid,
                            AssetMaster.deleted_at.is_(None),
                        )
                    ):
                        errors.append(f"Row {raw.row_number}: duplicate RFID.")
                        continue
                if self._db.scalar(
                    select(AssetMaster.id).where(
                        AssetMaster.asset_code == str(code).strip().upper(),
                        AssetMaster.deleted_at.is_(None),
                    )
                ):
                    errors.append(f"Row {raw.row_number}: duplicate asset code.")
                    continue
                cat_id = self._resolve_category_id(
                    category_id=None,
                    category_code=str(mapped.get("category_code") or "") or None,
                )
                loc = mapped.get("location")
                plant_id = self._resolve_plant_id(
                    plant_code=str(mapped.get("plant_code") or "") or None,
                    plant_id=loc.plant_id if loc else None,
                )
                fin = mapped.get("financial")
                tag_color_id = None
                try:
                    tag_color_id = self._resolve_tag_color_id(
                        tag_color_id=None,
                        tag_color_code=str(mapped.get("tag_color_code") or "") or None,
                    )
                except InvalidTagColorError as exc:
                    errors.append(f"Row {raw.row_number}: {exc.message}")
                    continue
                asset = AssetMaster(
                    asset_name=str(name).strip(),
                    asset_code=str(code).strip().upper(),
                    rfid_code=mapped.get("rfid_code"),
                    serial_no=mapped.get("serial_no"),
                    asset_category_id=cat_id,
                    asset_class=mapped.get("asset_class"),
                    asset_type=mapped.get("asset_type"),
                    tag_color_id=tag_color_id if rfid else None,
                    ownership_type=str(raw.data.get("ownership_type") or "").strip() or None,
                    source_type="import",
                    import_batch_id=batch.id,
                    created_by=actor_user_id,
                )
                set_asset_inactive_draft(asset)
                self._db.add(asset)
                self._db.flush()
                info = mapped.get("information")
                if info:
                    self._db.add(_apply_information(asset.id, info))
                if loc:
                    loc_payload = AssetLocationPayload(
                        plant_id=plant_id,
                        sub_location=loc.sub_location,
                        functional_location=loc.functional_location,
                        actual_location=loc.actual_location,
                    )
                    self._db.add(_apply_location(asset.id, loc_payload))
                if fin:
                    self._db.add(_apply_financial(asset.id, fin))
                self._db.add(_apply_inventory(asset.id, None))
                log_asset_event(
                    self._db,
                    asset_id=asset.id,
                    actor_user_id=actor_user_id,
                    action="imported",
                    new_value={
                        "source": "import",
                        "batch_id": batch.id,
                        "lifecycle_status": asset.lifecycle_status,
                        "approval_status": asset.approval_status,
                    },
                )
                created += 1
            except (DuplicateAssetCodeError, DuplicateRfidError):
                errors.append(f"Row {idx}: duplicate code or RFID.")
            except Exception as exc:
                errors.append(f"Row {idx}: {exc}")

        batch.valid_rows = created
        batch.error_rows = len(errors)
        batch.status = "completed" if not errors else "completed_with_errors"
        self._db.commit()
        return ImportConfirmResponse(
            batch_id=batch.id,
            created_count=created,
            pending_approval=False,
            errors=errors,
        )


def activate_asset_after_approval(db: Session, *, asset_id: int, approver_user_id: int | None) -> None:
    asset = db.get(AssetMaster, asset_id)
    if asset is None:
        return
    transition = set_asset_approved_active(asset, approver_user_id=approver_user_id)
    log_asset_event(
        db,
        asset_id=asset.id,
        actor_user_id=approver_user_id,
        action="approved",
        old_value=transition["before"],
        new_value={
            "source": asset.source_type,
            **transition["after"],
        },
    )
    log_asset_event(
        db,
        asset_id=asset.id,
        actor_user_id=approver_user_id,
        action="activated",
        old_value=transition["before"],
        new_value=transition["after"],
    )


def reject_asset_after_approval(db: Session, *, asset_id: int, approver_user_id: int | None) -> None:
    asset = db.get(AssetMaster, asset_id)
    if asset is None:
        return
    transition = set_asset_rejected_inactive(asset)
    log_asset_event(
        db,
        asset_id=asset.id,
        actor_user_id=approver_user_id,
        action="rejected",
        section="workflow",
        old_value=transition["before"],
        new_value=transition["after"],
    )
