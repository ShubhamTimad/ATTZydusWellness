from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, delete, func, or_, select, union_all
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
    set_asset_active_immediate,
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
from modules.assets.fy_verification import (
    VerificationWindow,
    count_verifications_by_asset,
    fy_verification_summary,
    resolve_verification_window,
    verified_asset_ids_in_window,
)
from modules.platform.settings.financial_year import (
    financial_year_period_for,
    list_financial_year_periods,
    resolve_financial_year_period,
)
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
    ProfitCenterMaster,
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
from modules.orders.constants import ACTION_COMPLETE, ACTIVE_ORDER_STATUSES, ORDER_STATUS_CLOSED
from modules.orders.model import PhysicalOrder, PhysicalOrderItem
from modules.assets.schema import (
    AssetActivePhysicalOrderPublic,
    AssetCreateRequest,
    AssetDetailPublic,
    AssetFinancialPayload,
    AssetInformationPayload,
    AssetInventoryPayload,
    AssetListItem,
    AssetListResponse,
    FinancialYearListResponse,
    FinancialYearOptionPublic,
    AssetLocationPayload,
    AssetUpdateRequest,
    ImportCancelBatchResponse,
    ImportConfirmChunkRequest,
    ImportConfirmChunkResponse,
    ImportConfirmRequest,
    ImportConfirmResponse,
    ImportPreviewRow,
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
        from modules.assets.field_definitions import required_manual_create_field_errors

        loc = data.location
        fin = data.financial
        required_errors = required_manual_create_field_errors(
            asset_name=data.asset_name,
            asset_code=data.asset_code,
            asset_category_id=data.asset_category_id,
            plant_id=loc.plant_id if loc else None,
            cost_center=fin.cost_center if fin else None,
            profit_center=fin.profit_center if fin else None,
            functional_location=loc.functional_location if loc else None,
            actual_location=loc.actual_location if loc else None,
        )
        if required_errors:
            raise ConflictError(next(iter(required_errors.values())))

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
        set_asset_active_immediate(asset)
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

    def _master_names_for_asset(
        self,
        loc: AssetLocationInformation | None,
        fin: AssetFinancialInformation | None,
    ) -> dict[str, str | None]:
        """Resolve display names for hierarchy masters stored as codes on the asset."""
        names: dict[str, str | None] = {
            "functional_location_name": None,
            "actual_location_name": None,
            "cost_center_name": None,
            "profit_center_name": None,
        }
        if loc is None or not loc.plant_id:
            return names
        pid = int(loc.plant_id)
        fl_code = (loc.functional_location or "").strip()
        al_code = (loc.actual_location or "").strip()
        fl_row: FunctionalLocationMaster | None = None
        if fl_code:
            fl_row = self._db.scalar(
                select(FunctionalLocationMaster).where(
                    FunctionalLocationMaster.plant_id == pid,
                    FunctionalLocationMaster.code == fl_code,
                )
            )
            if fl_row is not None:
                names["functional_location_name"] = str(fl_row.name)
                if al_code:
                    al_row = self._db.scalar(
                        select(ActualLocationMaster).where(
                            ActualLocationMaster.functional_location_id == fl_row.id,
                            ActualLocationMaster.code == al_code,
                        )
                    )
                    if al_row is not None:
                        names["actual_location_name"] = str(al_row.name)
        if fin is None:
            return names
        cc_code = (fin.cost_center or "").strip()
        pc_code = (fin.profit_center or "").strip()
        cc_row: CostCenterMaster | None = None
        if cc_code:
            cc_row = self._db.scalar(
                select(CostCenterMaster).where(
                    CostCenterMaster.plant_id == pid,
                    CostCenterMaster.code == cc_code,
                )
            )
            if cc_row is not None:
                names["cost_center_name"] = str(cc_row.name)
        if pc_code and cc_row is not None:
            pc_row = self._db.scalar(
                select(ProfitCenterMaster).where(
                    ProfitCenterMaster.cost_center_id == cc_row.id,
                    ProfitCenterMaster.code == pc_code,
                )
            )
            if pc_row is not None:
                names["profit_center_name"] = str(pc_row.name)
        return names

    def _orders_for_assets_by_status(
        self,
        asset_ids: list[int],
        statuses: frozenset[str] | set[str],
    ) -> dict[int, AssetActivePhysicalOrderPublic]:
        if not asset_ids or not statuses:
            return {}
        has_closure_workflow = get_workflow_for_action(self._db, ACTION_COMPLETE) is not None
        rows = self._db.execute(
            select(
                PhysicalOrderItem.asset_id,
                PhysicalOrder.id,
                PhysicalOrder.order_number,
                PhysicalOrder.status,
                PhysicalOrder.closed_at,
                PhysicalOrder.created_at,
            )
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .where(
                PhysicalOrderItem.asset_id.in_(asset_ids),
                PhysicalOrder.status.in_(tuple(statuses)),
            )
            .order_by(PhysicalOrder.created_at.desc())
        ).all()
        out: dict[int, AssetActivePhysicalOrderPublic] = {}
        for asset_id, order_id, order_number, order_status, closed_at, _created in rows:
            aid = int(asset_id)
            if aid in out:
                continue
            out[aid] = AssetActivePhysicalOrderPublic(
                order_id=int(order_id),
                order_number=str(order_number),
                order_status=str(order_status),
                closed_at=closed_at,
                has_closure_workflow=has_closure_workflow,
            )
        return out

    def _active_physical_orders_for_assets(
        self, asset_ids: list[int]
    ) -> dict[int, AssetActivePhysicalOrderPublic]:
        """Active order per asset; if none, the most recent closed order."""
        if not asset_ids:
            return {}
        out = self._orders_for_assets_by_status(asset_ids, ACTIVE_ORDER_STATUSES)
        missing = [aid for aid in asset_ids if aid not in out]
        if missing:
            closed = self._orders_for_assets_by_status(missing, frozenset({ORDER_STATUS_CLOSED}))
            out.update(closed)
        return out

    def _displayed_physical_order_subquery(self):
        """Per-asset physical order shown in the list: latest active, else latest closed."""
        active_ranked = (
            select(
                PhysicalOrderItem.asset_id.label("asset_id"),
                PhysicalOrder.status.label("order_status"),
                func.row_number()
                .over(
                    partition_by=PhysicalOrderItem.asset_id,
                    order_by=PhysicalOrder.created_at.desc(),
                )
                .label("rn"),
            )
            .select_from(PhysicalOrderItem)
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .where(PhysicalOrder.status.in_(tuple(ACTIVE_ORDER_STATUSES)))
        ).subquery("active_ranked")

        latest_active = (
            select(active_ranked.c.asset_id, active_ranked.c.order_status)
            .where(active_ranked.c.rn == 1)
            .subquery("latest_active")
        )

        active_asset_ids = select(latest_active.c.asset_id)

        closed_ranked = (
            select(
                PhysicalOrderItem.asset_id.label("asset_id"),
                PhysicalOrder.status.label("order_status"),
                func.row_number()
                .over(
                    partition_by=PhysicalOrderItem.asset_id,
                    order_by=PhysicalOrder.created_at.desc(),
                )
                .label("rn"),
            )
            .select_from(PhysicalOrderItem)
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .where(PhysicalOrder.status == ORDER_STATUS_CLOSED)
        ).subquery("closed_ranked")

        latest_closed_only = select(
            closed_ranked.c.asset_id,
            closed_ranked.c.order_status,
        ).where(
            closed_ranked.c.rn == 1,
            closed_ranked.c.asset_id.not_in(active_asset_ids),
        )

        return union_all(
            select(latest_active.c.asset_id, latest_active.c.order_status),
            latest_closed_only,
        ).subquery("displayed_physical_orders")

    def _apply_physical_order_status_filter(self, base: Any, physical_order_status: str | None) -> Any:
        if not physical_order_status or not physical_order_status.strip():
            return base
        status = physical_order_status.strip().lower()
        displayed = self._displayed_physical_order_subquery()
        if status == "none":
            has_displayed = select(displayed.c.asset_id)
            return base.where(AssetMaster.id.not_in(has_displayed))
        matching = select(displayed.c.asset_id).where(displayed.c.order_status == status)
        return base.where(AssetMaster.id.in_(matching))

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
            (int(r.plant_id), str(r.code)): str(r.name) for r in cc_rows
        }

        fl_rows = self._db.scalars(
            select(FunctionalLocationMaster).where(FunctionalLocationMaster.plant_id.in_(plant_ids))
        ).all()
        fl_desc: dict[tuple[int, str], str] = {
            (int(r.plant_id), str(r.code)): str(r.name) for r in fl_rows
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
                al_desc[(plant_id, fl_code, str(al.code))] = str(al.name)

        return cc_desc, fl_desc, al_desc

    def _asset_list_context(
        self,
        *,
        search: str | None = None,
        plant_id: int | None = None,
        category_id: int | None = None,
        fy_verification: str | None = None,
        fy_start_year: int | None = None,
        fy_scan_from: date | None = None,
        fy_scan_to: date | None = None,
    ) -> tuple[str, Any, VerificationWindow | None, dict[str, int] | None, set[int] | None]:
        fy_mode = (fy_verification or "").strip().lower()
        current_period = financial_year_period_for()
        fy_period = (
            resolve_financial_year_period(fy_start_year)
            if fy_mode in {"verified", "pending", "all"}
            else None
        )
        scan_window: VerificationWindow | None = None
        fy_summary: dict[str, int] | None = None
        verified_ids: set[int] | None = None
        if fy_period is not None:
            scan_window = resolve_verification_window(
                fy_period, scan_from=fy_scan_from, scan_to=fy_scan_to
            )
            fy_summary = fy_verification_summary(
                self._db,
                scan_window,
                plant_id=plant_id,
                category_id=category_id,
                search=search,
            )
            verified_ids = verified_asset_ids_in_window(
                self._db,
                scan_window,
                plant_id=plant_id,
                category_id=category_id,
                search=search,
            )
        return fy_mode, current_period, scan_window, fy_summary, verified_ids

    def _asset_list_base_query(
        self,
        *,
        search: str | None = None,
        plant_id: int | None = None,
        category_id: int | None = None,
        lifecycle_status: str | None = None,
        approval_status: str | None = None,
        physical_order_status: str | None = None,
        rfid_status: str | None = None,
        fy_verification: str | None = None,
        fy_start_year: int | None = None,
        fy_scan_from: date | None = None,
        fy_scan_to: date | None = None,
        source_type: str | None = None,
        cost_center: str | None = None,
        functional_location: str | None = None,
        actual_location: str | None = None,
        asset_ids: list[int] | None = None,
    ) -> tuple[Any, str, VerificationWindow | None, dict[str, int] | None, set[int] | None, int | None, int | None]:
        fy_mode, _current_period, scan_window, fy_summary, verified_ids = self._asset_list_context(
            search=search,
            plant_id=plant_id,
            category_id=category_id,
            fy_verification=fy_verification,
            fy_start_year=fy_start_year,
            fy_scan_from=fy_scan_from,
            fy_scan_to=fy_scan_to,
        )
        base = select(AssetMaster).where(AssetMaster.deleted_at.is_(None))
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
                base = base.where(
                    AssetMaster.lifecycle_status.in_((LIFECYCLE_INACTIVE, LIFECYCLE_PENDING_LEGACY))
                )
            else:
                base = base.where(AssetMaster.lifecycle_status == lifecycle_status)
        if approval_status:
            base = base.where(AssetMaster.approval_status == approval_status)
        if physical_order_status and scan_window is None:
            base = self._apply_physical_order_status_filter(base, physical_order_status)
        if source_type:
            base = base.where(AssetMaster.source_type == source_type.strip().lower())
        if asset_ids:
            base = base.where(AssetMaster.id.in_(asset_ids))

        location_joined = False
        financial_joined = False

        def _ensure_location_join() -> None:
            nonlocal base, location_joined
            if not location_joined:
                base = base.join(AssetLocationInformation)
                location_joined = True

        def _ensure_financial_join() -> None:
            nonlocal base, financial_joined
            if not financial_joined:
                base = base.join(AssetFinancialInformation)
                financial_joined = True

        if plant_id is not None:
            _ensure_location_join()
            base = base.where(AssetLocationInformation.plant_id == plant_id)
        cc_filter = (cost_center or "").strip()
        if cc_filter:
            _ensure_financial_join()
            base = base.where(AssetFinancialInformation.cost_center == cc_filter)
        fl_filter = (functional_location or "").strip()
        if fl_filter:
            _ensure_location_join()
            base = base.where(AssetLocationInformation.functional_location == fl_filter)
        al_filter = (actual_location or "").strip()
        if al_filter:
            _ensure_location_join()
            base = base.where(AssetLocationInformation.actual_location == al_filter)

        rfid_summary_tagged: int | None = None
        rfid_summary_not_tagged: int | None = None
        if scan_window is None:
            has_rfid = and_(AssetMaster.rfid_code.isnot(None), AssetMaster.rfid_code != "")
            no_rfid = or_(AssetMaster.rfid_code.is_(None), AssetMaster.rfid_code == "")
            rfid_summary_tagged = int(
                self._db.scalar(
                    select(func.count()).select_from(base.where(has_rfid).subquery())
                )
                or 0
            )
            rfid_summary_not_tagged = int(
                self._db.scalar(
                    select(func.count()).select_from(base.where(no_rfid).subquery())
                )
                or 0
            )
            rfid_mode = (rfid_status or "").strip().lower()
            if rfid_mode == "tagged":
                base = base.where(has_rfid)
            elif rfid_mode == "not_tagged":
                base = base.where(no_rfid)

        if scan_window is not None and verified_ids is not None:
            base = base.join(AssetInventoryInformation).where(
                AssetMaster.lifecycle_status == LIFECYCLE_ACTIVE,
                AssetMaster.rfid_code.isnot(None),
                AssetMaster.rfid_code != "",
            )
            if fy_mode == "verified":
                if verified_ids:
                    base = base.where(AssetMaster.id.in_(verified_ids))
                else:
                    base = base.where(AssetMaster.id == -1)
            elif fy_mode == "pending":
                if verified_ids:
                    base = base.where(AssetMaster.id.not_in(verified_ids))

        return (
            base,
            fy_mode,
            scan_window,
            fy_summary,
            verified_ids,
            rfid_summary_tagged,
            rfid_summary_not_tagged,
        )

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
        physical_order_status: str | None = None,
        rfid_status: str | None = None,
        fy_verification: str | None = None,
        fy_start_year: int | None = None,
        fy_scan_from: date | None = None,
        fy_scan_to: date | None = None,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
    ) -> AssetListResponse:
        page = max(1, page)
        page_size = min(max(1, page_size), 100)
        (
            base,
            _fy_mode,
            scan_window,
            fy_summary,
            verified_ids,
            rfid_summary_tagged,
            rfid_summary_not_tagged,
        ) = self._asset_list_base_query(
            search=search,
            plant_id=plant_id,
            category_id=category_id,
            lifecycle_status=lifecycle_status,
            approval_status=approval_status,
            physical_order_status=physical_order_status,
            rfid_status=rfid_status,
            fy_verification=fy_verification,
            fy_start_year=fy_start_year,
            fy_scan_from=fy_scan_from,
            fy_scan_to=fy_scan_to,
        )
        current_period = financial_year_period_for()
        fy_mode = (fy_verification or "").strip().lower()
        fy_period = (
            resolve_financial_year_period(fy_start_year)
            if fy_mode in {"verified", "pending", "all"}
            else None
        )
        base = base.options(
            selectinload(AssetMaster.category),
            selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
            selectinload(AssetMaster.financial),
            selectinload(AssetMaster.inventory),
        )

        count_stmt = select(func.count()).select_from(base.subquery())
        total = int(self._db.scalar(count_stmt) or 0)

        order_col = AssetMaster.created_at
        if sort_by == "asset_name":
            order_col = AssetMaster.asset_name
        elif sort_by == "asset_code":
            order_col = AssetMaster.asset_code
        elif sort_by == "last_verification_date":
            order_col = AssetInventoryInformation.last_verification_date
            if scan_window is None:
                base = base.outerjoin(AssetInventoryInformation)
        if sort_dir.lower() == "asc":
            base = base.order_by(order_col.asc())
        else:
            base = base.order_by(order_col.desc())

        rows = list(
            self._db.scalars(base.offset((page - 1) * page_size).limit(page_size)).unique().all()
        )
        fy_counts: dict[int, int] = {}
        if scan_window is not None:
            fy_counts = count_verifications_by_asset(
                self._db, [int(a.id) for a in rows], scan_window
            )
        cc_desc, fl_desc, al_desc = self._master_label_lookups(rows)
        active_orders = self._active_physical_orders_for_assets([int(a.id) for a in rows])
        items: list[AssetListItem] = []
        for a in rows:
            loc = a.location
            fin = a.financial
            inv = a.inventory
            last_verified = inv.last_verification_date if inv else None
            fy_verified = (
                int(a.id) in verified_ids if verified_ids is not None and (a.rfid_code and a.rfid_code.strip())
                else None
            )
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
                    last_verification_date=last_verified,
                    fy_verified=fy_verified,
                    fy_verification_count=fy_counts.get(int(a.id), 0) if scan_window else None,
                    lifecycle_status=a.lifecycle_status,
                    approval_status=a.approval_status,
                    source_type=a.source_type,
                    created_at=a.created_at,
                    active_physical_order=active_orders.get(int(a.id)),
                )
            )
        return AssetListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            financial_year_label=fy_period.label if fy_period else None,
            financial_year_start=fy_period.start if fy_period else None,
            financial_year_end=fy_period.end if fy_period else None,
            financial_year_start_year=fy_period.start.year if fy_period else None,
            financial_year_is_current=(
                fy_period.start == current_period.start and fy_period.end == current_period.end
                if fy_period
                else None
            ),
            scan_window_start=scan_window.start if scan_window else None,
            scan_window_end=scan_window.end if scan_window else None,
            total_fy_verification_events=(
                fy_summary["total_verification_scans"] if fy_summary else None
            ),
            verified_assets_total=fy_summary["verified_assets"] if fy_summary else None,
            pending_assets_total=fy_summary["pending_assets"] if fy_summary else None,
            total_rfid_assets=fy_summary["total_rfid_assets"] if fy_summary else None,
            rfid_tagged_total=rfid_summary_tagged,
            rfid_not_tagged_total=rfid_summary_not_tagged,
        )

    def export_assets(
        self,
        *,
        fields: list[str],
        plant_id: int | None = None,
        category_id: int | None = None,
        cost_center: str | None = None,
        functional_location: str | None = None,
        actual_location: str | None = None,
        fy_verification: str | None = None,
        fy_start_year: int | None = None,
        fy_scan_from: date | None = None,
        fy_scan_to: date | None = None,
        asset_ids: list[int] | None = None,
        sort_by: str = "asset_code",
        sort_dir: str = "asc",
        max_rows: int = 100_000,
    ) -> tuple[bytes, str, str]:
        from modules.assets.export import build_asset_export_xlsx
        from modules.assets.field_definitions import ASSET_EXPORT_FIELDS

        allowed = set(ASSET_EXPORT_FIELDS)
        export_fields = [f for f in fields if f in allowed]
        if not export_fields:
            raise ConflictError("Select at least one valid export field.")

        base, *_rest = self._asset_list_base_query(
            plant_id=plant_id,
            category_id=category_id,
            cost_center=cost_center,
            functional_location=functional_location,
            actual_location=actual_location,
            fy_verification=fy_verification,
            fy_start_year=fy_start_year,
            fy_scan_from=fy_scan_from,
            fy_scan_to=fy_scan_to,
            asset_ids=asset_ids,
        )
        base = base.options(
            selectinload(AssetMaster.category),
            selectinload(AssetMaster.tag_color),
            selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
            selectinload(AssetMaster.financial),
            selectinload(AssetMaster.inventory),
        )

        order_col = AssetMaster.asset_code
        if sort_by == "asset_name":
            order_col = AssetMaster.asset_name
        elif sort_by == "created_at":
            order_col = AssetMaster.created_at
        elif sort_by == "last_verification_date":
            order_col = AssetInventoryInformation.last_verification_date
            base = base.outerjoin(AssetInventoryInformation)
        if sort_dir.lower() == "desc":
            base = base.order_by(order_col.desc())
        else:
            base = base.order_by(order_col.asc())

        rows = list(self._db.scalars(base.limit(max_rows)).unique().all())
        content = build_asset_export_xlsx(rows, export_fields)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        filename = f"assets-export-{stamp}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return content, filename, media_type

    def list_financial_years(self, *, years_back: int = 10) -> FinancialYearListResponse:
        current = financial_year_period_for()
        items: list[FinancialYearOptionPublic] = []
        for period in list_financial_year_periods(years_back=years_back):
            items.append(
                FinancialYearOptionPublic(
                    label=period.label,
                    start=period.start,
                    end=period.end,
                    start_year=period.start.year,
                    is_current=period.start == current.start and period.end == current.end,
                )
            )
        return FinancialYearListResponse(items=items, current_start_year=current.start.year)

    def export_fy_verification_report(
        self,
        *,
        fmt: str,
        fy_verification: str | None = None,
        fy_start_year: int | None = None,
        fy_scan_from: date | None = None,
        fy_scan_to: date | None = None,
        plant_id: int | None = None,
        category_id: int | None = None,
        search: str | None = None,
    ) -> tuple[bytes, str, str]:
        from modules.reports.export import ReportDocument, build_pdf, build_xlsx, content_type_for_format, report_filename

        export_mode = (fy_verification or "all").strip().lower()
        if export_mode not in {"verified", "pending", "all"}:
            export_mode = "all"

        res = self.list_assets(
            page=1,
            page_size=100,
            search=search,
            plant_id=plant_id,
            category_id=category_id,
            fy_verification=export_mode,
            fy_start_year=fy_start_year,
            fy_scan_from=fy_scan_from,
            fy_scan_to=fy_scan_to,
            sort_by="last_verification_date",
            sort_dir="desc",
        )
        # Fetch all rows (up to reasonable limit)
        all_items = res.items
        if res.total > len(all_items):
            res = self.list_assets(
                page=1,
                page_size=min(res.total, 5000),
                search=search,
                plant_id=plant_id,
                category_id=category_id,
                fy_verification=export_mode,
                fy_start_year=fy_start_year,
                fy_scan_from=fy_scan_from,
                fy_scan_to=fy_scan_to,
                sort_by="last_verification_date",
                sort_dir="desc",
            )
            all_items = res.items

        window_label = ""
        if res.scan_window_start and res.scan_window_end:
            window_label = f"{res.scan_window_start.isoformat()} – {res.scan_window_end.isoformat()}"
        scope_label = {
            "verified": "Physically verified only",
            "pending": "Pending verification only",
            "all": "All RFID-tagged assets",
        }.get(export_mode, "All RFID-tagged assets")
        subtitle_parts = [
            res.financial_year_label or "Financial year",
            scope_label,
            f"Scans {window_label}" if window_label else "",
        ]
        summary = (
            ("Financial year", res.financial_year_label or "—"),
            ("Verification scope", scope_label),
            ("Scan period", window_label or "—"),
            ("Verified assets", str(res.verified_assets_total or 0)),
            ("Pending assets", str(res.pending_assets_total or 0)),
            ("RFID-tagged assets", str(res.total_rfid_assets or 0)),
            ("Rows exported", str(len(all_items))),
        )
        headers = [
            "Asset code",
            "Asset name",
            "Plant",
            "RFID code",
            "Last verification",
            "Status",
        ]
        rows = []
        for item in all_items:
            rows.append(
                [
                    item.asset_code,
                    item.asset_name,
                    item.plant_name or "",
                    item.rfid_code or "",
                    item.last_verification_date.isoformat() if item.last_verification_date else "",
                    "Verified" if item.fy_verified else "Pending",
                ]
            )
        doc = ReportDocument(
            title=f"Financial year physical verification · {res.financial_year_label or ''}".strip(),
            subtitle=" · ".join(p for p in subtitle_parts if p),
            summary=summary,
            headers=headers,
            rows=rows,
        )
        normalized = (fmt or "xlsx").strip().lower()
        if normalized == "pdf":
            content = build_pdf(doc)
        else:
            content = build_xlsx(doc)
            normalized = "xlsx"
        filename = report_filename("fy-physical-verification", normalized)
        return content, filename, content_type_for_format(normalized)

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
        period = financial_year_period_for()
        window = resolve_verification_window(period)
        rfid = (asset.rfid_code or "").strip()
        fy_count = (
            count_verifications_by_asset(self._db, [int(asset.id)], window).get(int(asset.id), 0)
            if rfid
            else None
        )
        master_names = self._master_names_for_asset(loc, fin)
        active_order = self._active_physical_orders_for_assets([int(asset.id)]).get(int(asset.id))
        location_payload: AssetLocationPayload | None = None
        if loc is not None:
            location_payload = AssetLocationPayload.model_validate(loc).model_copy(
                update={
                    "functional_location_name": master_names["functional_location_name"],
                    "actual_location_name": master_names["actual_location_name"],
                }
            )
        financial_payload: AssetFinancialPayload | None = None
        if fin is not None:
            financial_payload = AssetFinancialPayload.model_validate(fin).model_copy(
                update={
                    "cost_center_name": master_names["cost_center_name"],
                    "profit_center_name": master_names["profit_center_name"],
                }
            )
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
            location=location_payload,
            financial=financial_payload,
            inventory=AssetInventoryPayload.model_validate(inv) if inv else None,
            financial_year_label=period.label if rfid else None,
            active_physical_order=active_order,
            fy_verification_count=fy_count,
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
            nv = ev.new_value if isinstance(ev.new_value, dict) else {}
            if not include_asset_audit_event(ev.action, new_value=nv):
                continue
            actor = users_by_id.get(int(ev.actor_user_id)) if ev.actor_user_id else None
            name = actor_display(actor, ev.actor_user_id)
            change_rows: list[AssetAuditChangeLine] = []
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

    def build_import_template(self) -> tuple[bytes, str, str]:
        from modules.assets.import_template import build_import_template_xlsx

        content = build_import_template_xlsx(self._db)
        return (
            content,
            "asset-import-template.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def preview_import(self, *, filename: str | None, content: bytes) -> ImportPreviewResponse:
        rows = apply_import_validation(self._db, parse_upload_file(filename=filename, content=content))
        return ImportPreviewResponse(**build_preview_response(filename=filename, rows=rows))

    def validate_import_rows(
        self, *, filename: str | None, raw_rows: list[dict[str, Any]]
    ) -> ImportPreviewResponse:
        rows = apply_import_validation(self._db, rows_from_raw_dicts(raw_rows))
        return ImportPreviewResponse(**build_preview_response(filename=filename, rows=rows))

    def _import_validated_rows(
        self,
        *,
        batch: AssetImportBatch,
        validated_rows: list[ImportPreviewRow],
        actor_user_id: int | None,
    ) -> tuple[int, list[str]]:
        created = 0
        errors: list[str] = []

        for idx, raw in enumerate(validated_rows, start=1):
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
                set_asset_active_immediate(asset)
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

        return created, errors

    def confirm_import_chunk(
        self,
        body: ImportConfirmChunkRequest,
        *,
        actor_user_id: int | None,
    ) -> ImportConfirmChunkResponse:
        validated = self.validate_import_rows(filename=body.filename, raw_rows=body.rows)
        invalid = [r for r in validated.rows if not r.valid]
        if invalid:
            raise ImportValidationError(validated)

        if body.batch_id is not None:
            batch = self._db.get(AssetImportBatch, body.batch_id)
            if batch is None:
                raise NotFoundError("AssetImportBatch", body.batch_id)
            if batch.status not in ("processing",):
                raise ConflictError("Import batch is not accepting further chunks.")
        else:
            batch = AssetImportBatch(
                filename=body.filename,
                total_rows=body.total_rows,
                status="processing",
                created_by=actor_user_id,
            )
            self._db.add(batch)
            self._db.flush()

        created, errors = self._import_validated_rows(
            batch=batch,
            validated_rows=validated.rows,
            actor_user_id=actor_user_id,
        )
        batch.valid_rows = int(batch.valid_rows or 0) + created
        batch.error_rows = int(batch.error_rows or 0) + len(errors)

        processed_rows = min(body.processed_rows, body.total_rows)
        if body.is_final_chunk:
            batch.status = "completed" if not batch.error_rows else "completed_with_errors"

        percent = round((processed_rows / body.total_rows) * 100, 1) if body.total_rows else 100.0
        self._db.commit()

        return ImportConfirmChunkResponse(
            batch_id=int(batch.id),
            chunk_created_count=created,
            chunk_error_count=len(errors),
            total_created_count=int(batch.valid_rows),
            processed_rows=processed_rows,
            total_rows=body.total_rows,
            percent=percent,
            errors=errors,
            is_complete=body.is_final_chunk,
            pending_approval=False,
        )

    def cancel_import_batch(self, batch_id: int, *, actor_user_id: int | None) -> ImportCancelBatchResponse:
        batch = self._db.get(AssetImportBatch, batch_id)
        if batch is None:
            raise NotFoundError("AssetImportBatch", batch_id)
        if batch.status != "processing":
            raise ConflictError("Only in-progress imports can be cancelled.")

        asset_ids = list(
            self._db.scalars(
                select(AssetMaster.id).where(AssetMaster.import_batch_id == int(batch.id))
            ).all()
        )
        if asset_ids:
            self._db.execute(delete(AssetAuditEvent).where(AssetAuditEvent.asset_id.in_(asset_ids)))
            self._db.execute(delete(AssetMaster).where(AssetMaster.import_batch_id == int(batch.id)))

        self._db.delete(batch)
        self._db.commit()
        return ImportCancelBatchResponse(batch_id=batch_id, assets_removed=len(asset_ids))

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

        created, errors = self._import_validated_rows(
            batch=batch,
            validated_rows=validated.rows,
            actor_user_id=actor_user_id,
        )

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
