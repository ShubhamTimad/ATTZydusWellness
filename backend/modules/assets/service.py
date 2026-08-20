from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, cast, delete, false, func, or_, select, String, tuple_, union_all
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from modules.platform.approvals.assignment_service import get_workflow_for_action
from modules.platform.approvals.model import ApprovalTask, TaskAuditLog
from modules.platform.approvals.service import ApprovalEngineService
from core.permissions import get_flat_permission_codes_for_user
from modules.platform.users.scope import (
    ViewerOrgScope,
    asset_in_scope,
    list_viewer_scope,
    load_viewer_org_scope,
)
from modules.assets.lifecycle import (
    APPROVAL_APPROVED,
    APPROVAL_DRAFT,
    APPROVAL_PENDING,
    APPROVAL_REJECTED,
    APPROVED_LIST_HIDDEN_LIFECYCLES,
    LIFECYCLE_ACTIVE,
    LIFECYCLE_INACTIVE,
    LIFECYCLE_INACTIVE_FILTER,
    action_codes_for_asset,
    asset_approval_payload,
    can_deactivate,
    can_reactivate,
    can_submit_for_approval,
    find_latest_asset_approval_request,
    find_open_asset_approval_request,
    find_pending_asset_approval_request,
    is_awaiting_approval,
    is_pending_disposal,
    is_pending_transfer,
    set_asset_active_immediate,
    set_asset_approved_active,
    set_asset_deactivated,
    set_asset_inactive_draft,
    set_asset_pending_approval,
    set_asset_reactivated,
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
from modules.assets.list_search import asset_global_search_clause
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
    AssetClassMaster,
    AssetConditionMaster,
    CostCenterAssetCustodian,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.platform.users.model import User
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
    AssetApprovalPanel,
    AssetCreateRequest,
    AssetDetailPublic,
    AssetFinancialPayload,
    AssetInformationPayload,
    AssetImagePublic,
    AssetInventoryPayload,
    AssetListFilterOption,
    AssetListFilterOptionsResponse,
    AssetListItem,
    AssetListResponse,
    AssetWorkflowRunPublic,
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
from modules.errors import ConflictError, NotFoundError, PermissionDeniedError
from modules.platform.org_units.model import OrgUnit


class DuplicateCombinedAssetNumberError(Exception):
    pass


# Backward-compatible alias
DuplicateAssetCodeError = DuplicateCombinedAssetNumberError


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


class InvalidAssetMasterLookupError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class InvalidAssetImageError(Exception):
    pass


MAX_ASSET_IMAGE_BYTES = 5 * 1024 * 1024


def validate_asset_image(data: bytes) -> str:
    if not data:
        raise InvalidAssetImageError("Select an image to upload.")
    if len(data) > MAX_ASSET_IMAGE_BYTES:
        raise InvalidAssetImageError("Asset image must be 5 MB or smaller.")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise InvalidAssetImageError("Only PNG, JPEG, and WebP images are supported.")


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

DEFAULT_ASSET_LIST_COLUMNS = (
    "asset_code",
    "combined_asset_number",
    "asset_name",
    "rfid_code",
    "category_name",
    "cost_center",
    "functional_location",
    "inventory_count",
    "physical_count",
    "lifecycle_status",
)
ASSET_LIST_COLUMN_KEYS = frozenset(
    (
        *DEFAULT_ASSET_LIST_COLUMNS,
        "plant",
        "cost_center_name",
        "actual_location",
        "last_verification_date",
        "approval_status",
        "source_type",
        "created_at",
        "active_physical_order",
    )
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


def _asset_list_sort_expression(sort_by: str):
    """SQL expression for asset list / export ``sort_by`` (column header keys)."""
    key = (sort_by or "created_at").strip().lower()
    direct = {
        "created_at": AssetMaster.created_at,
        "asset_name": AssetMaster.asset_name,
        "asset_code": AssetMaster.asset_code,
        "combined_asset_number": AssetMaster.combined_asset_number,
        "rfid_code": AssetMaster.rfid_code,
        "lifecycle_status": AssetMaster.lifecycle_status,
        "approval_status": AssetMaster.approval_status,
        "source_type": AssetMaster.source_type,
    }
    if key in direct:
        return direct[key]

    if key == "category_name":
        return (
            select(AssetCategory.name)
            .where(AssetCategory.id == AssetMaster.asset_category_id)
            .correlate(AssetMaster)
            .scalar_subquery()
        )

    if key == "plant":
        return (
            select(OrgUnit.code)
            .select_from(AssetLocationInformation)
            .join(OrgUnit, OrgUnit.id == AssetLocationInformation.plant_id)
            .where(AssetLocationInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "cost_center":
        return (
            select(AssetFinancialInformation.cost_center)
            .where(AssetFinancialInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "cost_center_name":
        plant_id_sq = (
            select(AssetLocationInformation.plant_id)
            .where(AssetLocationInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )
        cc_code_sq = (
            select(AssetFinancialInformation.cost_center)
            .where(AssetFinancialInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )
        return (
            select(CostCenterMaster.name)
            .where(
                CostCenterMaster.plant_id == plant_id_sq,
                CostCenterMaster.code == cc_code_sq,
            )
            .limit(1)
            .scalar_subquery()
        )

    if key == "functional_location":
        return (
            select(AssetLocationInformation.functional_location)
            .where(AssetLocationInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "actual_location":
        return (
            select(AssetLocationInformation.actual_location)
            .where(AssetLocationInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "inventory_count":
        return (
            select(AssetInventoryInformation.inventory_count)
            .where(AssetInventoryInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "physical_count":
        return (
            select(AssetInventoryInformation.physical_count)
            .where(AssetInventoryInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "last_verification_date":
        return (
            select(AssetInventoryInformation.last_verification_date)
            .where(AssetInventoryInformation.asset_id == AssetMaster.id)
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    if key == "active_physical_order":
        return (
            select(PhysicalOrder.order_number)
            .select_from(PhysicalOrderItem)
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .where(
                PhysicalOrderItem.asset_id == AssetMaster.id,
                PhysicalOrder.status.in_(tuple(ACTIVE_ORDER_STATUSES)),
            )
            .order_by(PhysicalOrder.created_at.desc())
            .correlate(AssetMaster)
            .limit(1)
            .scalar_subquery()
        )

    return AssetMaster.created_at


def _apply_asset_list_sort(base: Any, *, sort_by: str, sort_dir: str) -> Any:
    order_col = _asset_list_sort_expression(sort_by)
    if (sort_dir or "desc").strip().lower() == "asc":
        return base.order_by(order_col.asc().nulls_last(), AssetMaster.id.asc())
    return base.order_by(order_col.desc().nulls_last(), AssetMaster.id.desc())


class AssetMasterService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_categories(self) -> list[AssetCategory]:
        return list(
            self._db.scalars(
                select(AssetCategory).where(AssetCategory.is_active.is_(True)).order_by(AssetCategory.name)
            ).all()
        )

    def list_custodian_users(self, *, cost_center_id: int | None = None) -> list[User]:
        """Users designated as asset custodians (optionally for one cost center)."""
        # Distinct on User.id only — full-row DISTINCT fails on users.asset_list_columns (JSON).
        id_stmt = (
            select(User.id)
            .join(
                CostCenterAssetCustodian,
                CostCenterAssetCustodian.user_id == User.id,
            )
            .where(User.is_active.is_(True))
            .distinct()
        )
        if cost_center_id is not None:
            id_stmt = id_stmt.where(CostCenterAssetCustodian.cost_center_id == int(cost_center_id))
        return list(
            self._db.scalars(
                select(User).where(User.id.in_(id_stmt)).order_by(User.full_name, User.username)
            ).all()
        )

    def get_asset_list_columns(self, user_id: int) -> list[str]:
        user = self._db.get(User, user_id)
        if user is None:
            raise NotFoundError("User", user_id)
        saved = user.asset_list_columns or []
        valid = [key for key in saved if key in ASSET_LIST_COLUMN_KEYS]
        return valid or list(DEFAULT_ASSET_LIST_COLUMNS)

    def update_asset_list_columns(self, user_id: int, columns: list[str]) -> list[str]:
        selected = list(dict.fromkeys(columns))
        if not selected:
            raise ValueError("Select at least one asset-list column.")
        invalid = [key for key in selected if key not in ASSET_LIST_COLUMN_KEYS]
        if invalid:
            raise ValueError(f"Unknown asset-list columns: {', '.join(invalid)}")
        user = self._db.get(User, user_id)
        if user is None:
            raise NotFoundError("User", user_id)
        user.asset_list_columns = selected
        self._db.commit()
        return selected

    def list_column_filter_options(
        self,
        *,
        viewer_user_id: int,
        plant_id: int | None = None,
    ) -> AssetListFilterOptionsResponse:
        """Distinct CC / location codes that appear on assets in the list scope."""
        raw_scope = load_viewer_org_scope(self._db, viewer_user_id)
        scope = list_viewer_scope(
            raw_scope,
            view_all=self._can_view_all_assets(viewer_user_id),
        )
        base, *_rest = self._asset_list_base_query(
            plant_id=plant_id,
            viewer_scope=scope,
        )
        asset_ids = base.with_only_columns(AssetMaster.id).order_by(None).scalar_subquery()

        cc_rows = self._db.execute(
            select(
                AssetFinancialInformation.cost_center,
                func.min(CostCenterMaster.name),
            )
            .select_from(AssetFinancialInformation)
            .outerjoin(
                CostCenterMaster,
                CostCenterMaster.code == AssetFinancialInformation.cost_center,
            )
            .where(
                AssetFinancialInformation.asset_id.in_(asset_ids),
                AssetFinancialInformation.cost_center.isnot(None),
                AssetFinancialInformation.cost_center != "",
            )
            .group_by(AssetFinancialInformation.cost_center)
            .order_by(AssetFinancialInformation.cost_center)
        ).all()
        cost_centers = [
            AssetListFilterOption(code=str(code), name=str(name) if name else None)
            for code, name in cc_rows
            if code
        ]

        assigned_codes = sorted({code for _, code in (raw_scope.cost_center_keys or ())})
        name_by_code = {opt.code: opt.name for opt in cost_centers}
        if assigned_codes:
            missing = [c for c in assigned_codes if c not in name_by_code]
            if missing:
                for code, name in self._db.execute(
                    select(CostCenterMaster.code, CostCenterMaster.name).where(
                        CostCenterMaster.code.in_(missing)
                    )
                ).all():
                    name_by_code[str(code)] = str(name) if name else None
            existing = {opt.code for opt in cost_centers}
            for code in assigned_codes:
                if code not in existing:
                    cost_centers.append(
                        AssetListFilterOption(code=code, name=name_by_code.get(code))
                    )
            cost_centers.sort(key=lambda opt: opt.code)
        assigned_cost_centers = [
            AssetListFilterOption(code=code, name=name_by_code.get(code))
            for code in assigned_codes
        ]

        fl_rows = self._db.execute(
            select(
                AssetLocationInformation.functional_location,
                func.min(FunctionalLocationMaster.name),
            )
            .select_from(AssetLocationInformation)
            .outerjoin(
                FunctionalLocationMaster,
                FunctionalLocationMaster.code == AssetLocationInformation.functional_location,
            )
            .where(
                AssetLocationInformation.asset_id.in_(asset_ids),
                AssetLocationInformation.functional_location.isnot(None),
                AssetLocationInformation.functional_location != "",
            )
            .group_by(AssetLocationInformation.functional_location)
            .order_by(AssetLocationInformation.functional_location)
        ).all()
        functional_locations = [
            AssetListFilterOption(code=str(code), name=str(name) if name else None)
            for code, name in fl_rows
            if code
        ]

        al_rows = self._db.execute(
            select(
                AssetLocationInformation.actual_location,
                func.min(ActualLocationMaster.name),
            )
            .select_from(AssetLocationInformation)
            .outerjoin(
                ActualLocationMaster,
                ActualLocationMaster.code == AssetLocationInformation.actual_location,
            )
            .where(
                AssetLocationInformation.asset_id.in_(asset_ids),
                AssetLocationInformation.actual_location.isnot(None),
                AssetLocationInformation.actual_location != "",
            )
            .group_by(AssetLocationInformation.actual_location)
            .order_by(AssetLocationInformation.actual_location)
        ).all()
        actual_locations = [
            AssetListFilterOption(code=str(code), name=str(name) if name else None)
            for code, name in al_rows
            if code
        ]

        return AssetListFilterOptionsResponse(
            cost_centers=cost_centers,
            functional_locations=functional_locations,
            actual_locations=actual_locations,
            assigned_cost_centers=assigned_cost_centers,
        )

    def get_asset_image(self, asset_id: int) -> tuple[bytes, str, str]:
        asset = self._load_asset(asset_id)
        if not asset.image_data or not asset.image_content_type:
            raise NotFoundError("Asset image", asset_id)
        return (
            bytes(asset.image_data),
            asset.image_content_type,
            asset.image_filename or "asset-image",
        )

    def set_asset_image(
        self,
        asset_id: int,
        *,
        data: bytes,
        filename: str | None,
        actor_user_id: int,
        part_of_create: bool = False,
    ) -> AssetImagePublic:
        content_type = validate_asset_image(data)
        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        safe_filename = (filename or "asset-image").replace("\\", "/").rsplit("/", 1)[-1][:255]
        had_image = bool(asset.image_content_type)
        asset.image_data = data
        asset.image_content_type = content_type
        asset.image_filename = safe_filename or "asset-image"
        asset.updated_at = _now()
        self._db.flush()
        # Create flow uploads image right after create — keep a single "created" audit.
        if not (part_of_create and not had_image):
            log_asset_event(
                self._db,
                asset_id=asset.id,
                actor_user_id=actor_user_id,
                action="asset_image_updated" if had_image else "asset_image_added",
                old_value=None,
                new_value={"image_filename": asset.image_filename},
            )
        self._db.commit()
        return AssetImagePublic(
            has_image=True,
            image_filename=asset.image_filename,
            image_content_type=content_type,
        )

    def delete_asset_image(self, asset_id: int, *, actor_user_id: int) -> None:
        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        if not asset.image_content_type:
            return
        old_filename = asset.image_filename
        asset.image_data = None
        asset.image_content_type = None
        asset.image_filename = None
        asset.updated_at = _now()
        self._db.flush()
        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="asset_image_removed",
            old_value={"image_filename": old_filename},
            new_value=None,
        )
        self._db.commit()

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

    def _resolve_asset_custodian_id(
        self, *, asset_custodian_id: int | None, asset_custodian_code: str | None
    ) -> int | None:
        if asset_custodian_id is not None:
            row = self._db.get(User, asset_custodian_id)
            if row is None or not row.is_active:
                raise InvalidAssetMasterLookupError("Unknown or inactive asset custodian.")
            return int(row.id)
        if asset_custodian_code:
            row = self._db.scalar(
                select(User).where(
                    func.lower(User.username) == asset_custodian_code.strip().lower(),
                    User.is_active.is_(True),
                )
            )
            if row is None:
                raise InvalidAssetMasterLookupError("Unknown asset custodian username.")
            return int(row.id)
        return None

    def _resolve_asset_condition_id(
        self, *, asset_condition_id: int | None, asset_condition_code: str | None
    ) -> int | None:
        if asset_condition_id is not None:
            row = self._db.get(AssetConditionMaster, asset_condition_id)
            if row is None or not row.is_active:
                raise InvalidAssetMasterLookupError("Unknown or inactive asset condition.")
            return int(row.id)
        if asset_condition_code:
            row = self._db.scalar(
                select(AssetConditionMaster).where(
                    func.lower(AssetConditionMaster.code) == asset_condition_code.strip().lower(),
                    AssetConditionMaster.is_active.is_(True),
                )
            )
            if row is None:
                raise InvalidAssetMasterLookupError("Unknown asset condition code.")
            return int(row.id)
        return None

    def _resolve_asset_class_id(
        self, *, asset_class_id: int | None, asset_class_code: str | None
    ) -> int | None:
        if asset_class_id is not None:
            row = self._db.get(AssetClassMaster, asset_class_id)
            if row is None or not row.is_active:
                raise InvalidAssetMasterLookupError("Unknown or inactive asset class.")
            return int(row.id)
        if asset_class_code:
            code = asset_class_code.strip().lower()
            row = self._db.scalar(
                select(AssetClassMaster).where(
                    or_(
                        func.lower(AssetClassMaster.code) == code,
                        func.lower(AssetClassMaster.name) == code,
                    ),
                    AssetClassMaster.is_active.is_(True),
                )
            )
            if row is None:
                raise InvalidAssetMasterLookupError("Unknown asset class code.")
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

    def _set_asset_custodian(self, asset: AssetMaster, asset_custodian_id: int | None) -> None:
        if asset_custodian_id is not None:
            row = self._db.get(User, asset_custodian_id)
            if row is None or not row.is_active:
                raise InvalidAssetMasterLookupError("Unknown or inactive asset custodian.")
            asset.asset_custodian_id = int(asset_custodian_id)
        else:
            asset.asset_custodian_id = None

    def _set_asset_condition(self, asset: AssetMaster, asset_condition_id: int | None) -> None:
        if asset_condition_id is not None:
            row = self._db.get(AssetConditionMaster, asset_condition_id)
            if row is None or not row.is_active:
                raise InvalidAssetMasterLookupError("Unknown or inactive asset condition.")
            asset.asset_condition_id = int(asset_condition_id)
        else:
            asset.asset_condition_id = None

    def _set_asset_class(self, asset: AssetMaster, asset_class_id: int | None) -> None:
        if asset_class_id is not None:
            row = self._db.get(AssetClassMaster, asset_class_id)
            if row is None or not row.is_active:
                raise InvalidAssetMasterLookupError("Unknown or inactive asset class.")
            asset.asset_class_id = int(asset_class_id)
            # Keep legacy free-text column in sync for older readers/exports.
            asset.asset_class = (row.name or row.code)[:128]
        else:
            asset.asset_class_id = None
            asset.asset_class = None

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
        self,
        asset: AssetMaster,
        *,
        actor_user_id: int | None,
        assignee_user_id: int | None = None,
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
            if assignee_user_id is None or int(assignee_user_id) < 1:
                raise ConflictError("Select an approver before submitting.")
            from modules.platform.approvals.service import ApprovalError

            try:
                ApprovalEngineService(self._db).resubmit_rejected_request(
                    request_id=int(req.id),
                    actor_user_id=int(actor_user_id),
                    assigned_user_id=int(assignee_user_id),
                )
            except ApprovalError as exc:
                raise ConflictError(str(exc)) from exc
            # resubmit_rejected_request commits and already sets pending; refresh + audit.
            self._db.refresh(asset)
            assignee = self._db.get(User, int(assignee_user_id))
            assignee_name = (
                (assignee.full_name or assignee.email or f"User #{assignee_user_id}")
                if assignee is not None
                else f"User #{assignee_user_id}"
            )
            log_asset_event(
                self._db,
                asset_id=asset.id,
                actor_user_id=actor_user_id,
                action="submitted_for_approval",
                new_value={
                    "action_code": action_code,
                    "resubmit": True,
                    "assignee_user_id": int(assignee_user_id),
                    "assignee_name": assignee_name,
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

        if assignee_user_id is None or int(assignee_user_id) < 1:
            raise ConflictError("Select an approver before submitting.")

        set_asset_pending_approval(asset)
        payload = asset_approval_payload(asset, action_code=action_code, extra=extra)
        ApprovalEngineService(self._db).create_request_for_entity(
            workflow=wf,
            entity_type=entity_type,
            entity_id=asset.id,
            payload=payload,
            created_by=actor_user_id,
            assigned_user_id=int(assignee_user_id),
        )
        assignee = self._db.get(User, int(assignee_user_id))
        assignee_name = (
            (assignee.full_name or assignee.email or f"User #{assignee_user_id}")
            if assignee is not None
            else f"User #{assignee_user_id}"
        )
        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="submitted_for_approval",
            new_value={
                "action_code": action_code,
                "assignee_user_id": int(assignee_user_id),
                "assignee_name": assignee_name,
                "lifecycle_status": asset.lifecycle_status,
                "approval_status": asset.approval_status,
            },
        )
        return "submitted"

    def submit_for_approval(
        self,
        asset_ids: list[int],
        *,
        actor_user_id: int | None,
        assignee_user_id: int | None = None,
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
                self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
                outcome = self._submit_one_asset_for_approval(
                    asset,
                    actor_user_id=actor_user_id,
                    assignee_user_id=assignee_user_id,
                )
                if outcome == "submitted":
                    submitted_count += 1
                else:
                    activated_count += 1
            except NotFoundError:
                errors.append(f"Asset #{aid}: not found.")
            except PermissionDeniedError as exc:
                errors.append(str(exc))
            except ConflictError as exc:
                errors.append(str(exc))
            except Exception as exc:
                errors.append(f"Asset #{aid}: {exc}")
        if submitted_count or activated_count:
            try:
                self._db.commit()
            except Exception as exc:
                self._db.rollback()
                raise ConflictError(f"Submit for Approval failed: {exc}") from exc
        elif errors:
            self._db.rollback()
        return SubmitForApprovalResponse(
            submitted_count=submitted_count,
            activated_count=activated_count,
            errors=errors,
        )

    def _asset_ids_viewer_can_approve(
        self, asset_ids: list[int], *, viewer_user_id: int
    ) -> set[int]:
        """Asset ids whose pending creation/import approval task is assigned to the viewer."""
        if not asset_ids:
            return set()
        from modules.platform.approvals.model import ApprovalRequest, ApprovalTask
        from modules.platform.approvals.service import ApprovalEngineService

        req_rows = self._db.execute(
            select(ApprovalRequest.id, ApprovalRequest.entity_id).where(
                ApprovalRequest.entity_type.in_(("asset_creation", "asset_import")),
                ApprovalRequest.entity_id.in_([int(i) for i in asset_ids]),
                ApprovalRequest.status == "pending",
            )
        ).all()
        if not req_rows:
            return set()
        # Latest pending request wins if duplicates exist.
        latest_by_asset: dict[int, int] = {}
        for rid, aid in req_rows:
            rid_i, aid_i = int(rid), int(aid)
            if aid_i not in latest_by_asset or rid_i > latest_by_asset[aid_i]:
                latest_by_asset[aid_i] = rid_i
        req_to_asset = {rid: aid for aid, rid in latest_by_asset.items()}
        if not req_to_asset:
            return set()
        uid = int(viewer_user_id)
        role_ids = ApprovalEngineService(self._db)._role_ids_for_user(uid)
        tasks = self._db.scalars(
            select(ApprovalTask).where(
                ApprovalTask.request_id.in_(list(req_to_asset.keys())),
                ApprovalTask.task_type == "approval",
                ApprovalTask.status == "pending",
            )
        ).all()
        out: set[int] = set()
        for t in tasks:
            aid = req_to_asset.get(int(t.request_id))
            if aid is None:
                continue
            if t.assigned_user_id is not None:
                if int(t.assigned_user_id) == uid:
                    out.add(aid)
            elif t.assigned_role_id is not None and int(t.assigned_role_id) in role_ids:
                out.add(aid)
        return out

    def _pending_task_for_actor(self, *, asset_id: int, actor_user_id: int):
        """Pending approval task the actor may act on (user handoff or role pool)."""
        from modules.platform.approvals.model import ApprovalRequest, ApprovalTask
        from modules.platform.approvals.service import ApprovalEngineService

        req_row = find_pending_asset_approval_request(self._db, asset_id=int(asset_id))
        if req_row is None:
            return None
        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(req_row.id))
            .options(selectinload(ApprovalRequest.tasks))
        )
        if req is None:
            return None
        role_ids = ApprovalEngineService(self._db)._role_ids_for_user(int(actor_user_id))
        for t in req.tasks or []:
            if str(t.task_type) != "approval":
                continue
            if str(t.status).lower() != "pending":
                continue
            if t.assigned_user_id is not None:
                if int(t.assigned_user_id) == int(actor_user_id):
                    return t
            elif t.assigned_role_id is not None and int(t.assigned_role_id) in role_ids:
                return t
        return None

    def bulk_decision(
        self,
        asset_ids: list[int],
        *,
        actor_user_id: int,
        action: str,
        comment: str,
    ):
        from modules.assets.schema import AssetBulkDecisionResponse
        from modules.platform.approvals.service import ApprovalError

        note = (comment or "").strip()
        if not note:
            raise ConflictError("Reason is required.")
        act = (action or "").strip().lower()
        if act not in ("approve", "reject"):
            raise ConflictError("action must be approve or reject.")

        engine = ApprovalEngineService(self._db)
        processed = 0
        errors: list[str] = []
        seen: set[int] = set()
        for raw_id in asset_ids:
            aid = int(raw_id)
            if aid in seen:
                continue
            seen.add(aid)
            try:
                asset = self._load_asset(aid)
                if (asset.approval_status or "").strip().lower() != APPROVAL_PENDING:
                    errors.append(f"Asset {asset.asset_code}: not pending approval.")
                    continue
                task = self._pending_task_for_actor(asset_id=aid, actor_user_id=actor_user_id)
                if task is None:
                    errors.append(
                        f"Asset {asset.asset_code}: no pending approval assigned to you."
                    )
                    continue
                engine.act_on_task(
                    task_id=int(task.id),
                    actor_user_id=int(actor_user_id),
                    action=act,
                    comment=note,
                )
                processed += 1
            except NotFoundError:
                errors.append(f"Asset #{aid}: not found.")
            except (ConflictError, ApprovalError) as exc:
                errors.append(str(exc))
            except Exception as exc:
                errors.append(f"Asset #{aid}: {exc}")
        return AssetBulkDecisionResponse(processed_count=processed, errors=errors)

    def list_assignees_for_action(self, *, action_code: str):
        from modules.assets.schema import AssetAssigneeListResponse, AssetAssigneeOption
        from modules.platform.roles.model import Role
        from modules.rbac_association import user_role

        code = (action_code or "asset.create").strip()
        if code not in ("asset.create", "asset.import"):
            raise ConflictError("action must be asset.create or asset.import.")
        wf = get_workflow_for_action(self._db, code)
        if wf is None or not wf.steps:
            raise ConflictError(
                "No active asset approval workflow is configured. Map a workflow in Admin."
            )
        first = sorted(wf.steps, key=lambda s: int(s.step_order))[0]
        role = self._db.get(Role, int(first.approver_role_id))
        if role is None:
            raise ConflictError("Workflow approver role is missing.")
        users = list(
            self._db.scalars(
                select(User)
                .select_from(user_role)
                .join(User, User.id == user_role.c.user_id)
                .where(user_role.c.role_id == int(role.id), User.is_active.is_(True))
                .order_by(User.full_name.asc(), User.id.asc())
            ).all()
        )
        return AssetAssigneeListResponse(
            role_name=str(role.name),
            items=[
                AssetAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def list_assignees_for_asset(self, asset_id: int):
        """Users in the current pending step role (reassign) or workflow first step (submit)."""
        from modules.assets.schema import AssetAssigneeListResponse, AssetAssigneeOption
        from modules.platform.approvals.model import ApprovalRequest, ApprovalTask
        from modules.platform.roles.model import Role
        from modules.rbac_association import user_role

        asset = self._load_asset(asset_id)
        role_id: int | None = None

        pending_req = find_pending_asset_approval_request(self._db, asset_id=int(asset.id))
        if pending_req is not None:
            req = self._db.scalar(
                select(ApprovalRequest)
                .where(ApprovalRequest.id == int(pending_req.id))
                .options(selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step))
            )
            pending = (
                next(
                    (
                        t
                        for t in (req.tasks or [])
                        if str(t.task_type) == "approval" and str(t.status).lower() == "pending"
                    ),
                    None,
                )
                if req
                else None
            )
            if pending is not None and pending.step is not None:
                role_id = int(pending.step.approver_role_id)

        if role_id is None:
            action_code, _ = action_codes_for_asset(asset)
            return self.list_assignees_for_action(action_code=action_code)

        role = self._db.get(Role, role_id)
        if role is None:
            raise ConflictError("Approver role is missing.")
        users = list(
            self._db.scalars(
                select(User)
                .select_from(user_role)
                .join(User, User.id == user_role.c.user_id)
                .where(user_role.c.role_id == role_id, User.is_active.is_(True))
                .order_by(User.full_name.asc(), User.id.asc())
            ).all()
        )
        return AssetAssigneeListResponse(
            role_name=str(role.name),
            items=[
                AssetAssigneeOption(id=int(u.id), full_name=u.full_name, email=u.email)
                for u in users
            ],
        )

    def reassign_approver(
        self, asset_id: int, *, actor_user_id: int, assignee_user_id: int
    ) -> AssetDetailPublic:
        from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, TaskAuditLog
        from modules.platform.roles.model import Role

        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        if (asset.approval_status or "").strip().lower() != APPROVAL_PENDING:
            raise ConflictError("Approver can only be reassigned while the asset is pending approval.")

        req_row = find_pending_asset_approval_request(self._db, asset_id=int(asset.id))
        if req_row is None:
            raise ConflictError("No active approval request to reassign.")

        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(req_row.id))
            .options(selectinload(ApprovalRequest.tasks).selectinload(ApprovalTask.step))
        )
        if req is None or str(req.status) != "pending":
            raise ConflictError("Approval request is not pending.")

        pending = next(
            (
                t
                for t in (req.tasks or [])
                if str(t.task_type) == "approval" and str(t.status).lower() == "pending"
            ),
            None,
        )
        if pending is None or pending.step is None:
            raise ConflictError("No pending approval step to reassign.")

        if pending.assigned_user_id is not None and int(pending.assigned_user_id) == int(
            assignee_user_id
        ):
            raise ConflictError("Select a different approver.")

        engine = ApprovalEngineService(self._db)
        role_id = int(pending.step.approver_role_id)
        role = self._db.get(Role, role_id)
        role_name = role.name if role is not None else "Approvers"
        role_users = engine._users_for_role(role_id)
        if not any(int(u.id) == int(assignee_user_id) for u in role_users):
            raise ConflictError(f"Selected user is not an active member of role {role_name!r}.")

        def _uname(uid: int | None) -> str | None:
            if uid is None:
                return None
            u = self._db.get(User, int(uid))
            if u is None:
                return f"User #{uid}"
            return u.full_name or u.email or f"User #{uid}"

        old_id = int(pending.assigned_user_id) if pending.assigned_user_id is not None else None
        old_name = _uname(old_id)
        new_name = _uname(assignee_user_id)

        pending.assigned_user_id = int(assignee_user_id)
        pending.assigned_role_id = None
        self._db.flush()
        self._db.add(
            TaskAuditLog(
                task_id=int(pending.id),
                action="assigned",
                actor_user_id=actor_user_id,
                old_value={"assigned_user_id": old_id, "assigned_user_name": old_name},
                new_value={
                    "assigned_user_id": int(assignee_user_id),
                    "assigned_user_name": new_name,
                },
            )
        )
        log_asset_event(
            self._db,
            asset_id=int(asset.id),
            actor_user_id=actor_user_id,
            action="reassigned",
            old_value={"assignee_user_id": old_id, "assignee_name": old_name, "role_name": role_name},
            new_value={
                "assignee_user_id": int(assignee_user_id),
                "assignee_name": new_name,
                "role_name": role_name,
            },
        )
        try:
            engine._notify_approvers_for_task(task=pending, req=req)
        except Exception:
            pass
        self._db.commit()
        return self.get_asset(asset_id, viewer_user_id=actor_user_id)

    def create_asset(
        self, data: AssetCreateRequest, *, actor_user_id: int | None
    ) -> AssetDetailPublic:
        from modules.assets.field_definitions import required_manual_create_field_errors

        loc = data.location
        fin = data.financial
        required_errors = required_manual_create_field_errors(
            asset_name=data.asset_name,
            asset_code=data.asset_code or "",
            combined_asset_number=data.combined_asset_number,
            asset_category_id=data.asset_category_id,
            plant_id=loc.plant_id if loc else None,
            cost_center=fin.cost_center if fin else None,
            profit_center=fin.profit_center if fin else None,
            functional_location=loc.functional_location if loc else None,
            actual_location=loc.actual_location if loc else None,
            db=self._db,
        )
        if required_errors:
            raise ConflictError(next(iter(required_errors.values())))

        can = data.combined_asset_number.strip().upper()
        if self._db.scalar(
            select(AssetMaster.id).where(
                AssetMaster.combined_asset_number == can,
                AssetMaster.deleted_at.is_(None),
            )
        ):
            raise DuplicateCombinedAssetNumberError()
        code = (data.asset_code or "").strip().upper()
        if data.rfid_code:
            rfid = _normalize_rfid(data.rfid_code)
            if rfid:
                _assert_rfid_available(self._db, rfid=rfid, exclude_asset_id=None)

        asset = AssetMaster(
            asset_name=data.asset_name.strip(),
            asset_code=code,
            combined_asset_number=can,
            remark=(data.remark.strip() if data.remark and data.remark.strip() else None),
            sub_no=(data.sub_no.strip() if data.sub_no and data.sub_no.strip() else None),
            rfid_code=data.rfid_code.strip() if data.rfid_code else None,
            serial_no=data.serial_no.strip() if data.serial_no else None,
            asset_category_id=data.asset_category_id,
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
        if data.asset_custodian_id is not None:
            self._set_asset_custodian(asset, data.asset_custodian_id)
        if data.asset_condition_id is not None:
            self._set_asset_condition(asset, data.asset_condition_id)
        class_id = data.asset_class_id
        if class_id is None and data.asset_class:
            class_id = self._resolve_asset_class_id(
                asset_class_id=None, asset_class_code=data.asset_class
            )
        if class_id is not None:
            self._set_asset_class(asset, class_id)

        capex_form_id = data.capitalization_form_id
        if capex_form_id is not None:
            from modules.capex.service import CapexFormService

            CapexFormService(self._db).link_to_asset(
                int(capex_form_id),
                asset_id=int(asset.id),
                actor_user_id=actor_user_id,
                asset_code=code,
            )

        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="created",
            new_value={
                "source": "manual",
                "combined_asset_number": can,
                "asset_code": code,
                "lifecycle_status": asset.lifecycle_status,
                "approval_status": asset.approval_status,
                "capitalization_form_id": capex_form_id,
            },
        )
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            msg = str(exc).lower()
            if "rfid" in msg:
                raise DuplicateRfidError() from exc
            raise DuplicateCombinedAssetNumberError() from exc
        return self.get_asset(asset.id, viewer_user_id=actor_user_id)

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
            has_displayed = select(displayed.c.asset_id).correlate(None)
            return base.where(AssetMaster.id.not_in(has_displayed))
        matching = select(displayed.c.asset_id).where(displayed.c.order_status == status).correlate(None)
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
        search_columns: list[str] | None = None,
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
                search_columns=search_columns,
            )
            verified_ids = verified_asset_ids_in_window(
                self._db,
                scan_window,
                plant_id=plant_id,
                category_id=category_id,
                search=search,
                search_columns=search_columns,
            )
        return fy_mode, current_period, scan_window, fy_summary, verified_ids

    def _apply_column_filters(self, base: Any, column_filters: dict[str, str] | None) -> Any:
        """Per-column contains filters from the list header (all optional)."""
        if not column_filters:
            return base
        f = {k: (v or "").strip() for k, v in column_filters.items()}

        def _like(key: str) -> str:
            return f"%{f[key]}%"

        if f.get("asset_code"):
            base = base.where(AssetMaster.asset_code.ilike(_like("asset_code")))
        if f.get("combined_asset_number"):
            base = base.where(
                AssetMaster.combined_asset_number.ilike(_like("combined_asset_number"))
            )
        if f.get("asset_name"):
            base = base.where(AssetMaster.asset_name.ilike(_like("asset_name")))
        if f.get("rfid_code"):
            base = base.where(AssetMaster.rfid_code.ilike(_like("rfid_code")))
        if f.get("category"):
            q = _like("category")
            base = base.where(
                AssetMaster.asset_category_id.in_(
                    select(AssetCategory.id)
                    .where(or_(AssetCategory.name.ilike(q), AssetCategory.code.ilike(q)))
                    .correlate(None)
                )
            )
        if f.get("cost_center"):
            # Dropdown sends the exact code; name-contains kept for direct API use.
            # Explicit FROM + correlate(AssetMaster): nested IN/EXISTS must not
            # collapse when the outer list query is counted via with_only_columns.
            matching_cc = (
                select(CostCenterMaster.code)
                .where(CostCenterMaster.name.ilike(_like("cost_center")))
                .correlate(None)
            )
            base = base.where(
                select(1)
                .select_from(AssetFinancialInformation)
                .where(
                    AssetFinancialInformation.asset_id == AssetMaster.id,
                    or_(
                        AssetFinancialInformation.cost_center == f["cost_center"],
                        AssetFinancialInformation.cost_center.in_(matching_cc),
                    ),
                )
                .correlate(AssetMaster)
                .exists()
            )
        if f.get("functional_location"):
            matching_fl = (
                select(FunctionalLocationMaster.code)
                .where(FunctionalLocationMaster.name.ilike(_like("functional_location")))
                .correlate(None)
            )
            base = base.where(
                select(1)
                .select_from(AssetLocationInformation)
                .where(
                    AssetLocationInformation.asset_id == AssetMaster.id,
                    or_(
                        AssetLocationInformation.functional_location == f["functional_location"],
                        AssetLocationInformation.functional_location.in_(matching_fl),
                    ),
                )
                .correlate(AssetMaster)
                .exists()
            )
        if f.get("actual_location"):
            matching_al = (
                select(ActualLocationMaster.code)
                .where(ActualLocationMaster.name.ilike(_like("actual_location")))
                .correlate(None)
            )
            base = base.where(
                select(1)
                .select_from(AssetLocationInformation)
                .where(
                    AssetLocationInformation.asset_id == AssetMaster.id,
                    or_(
                        AssetLocationInformation.actual_location == f["actual_location"],
                        AssetLocationInformation.actual_location.in_(matching_al),
                    ),
                )
                .correlate(AssetMaster)
                .exists()
            )
        if f.get("inventory_count"):
            try:
                inv_n = int(f["inventory_count"])
            except ValueError:
                base = base.where(false())
            else:
                base = base.where(
                    select(1)
                    .select_from(AssetInventoryInformation)
                    .where(
                        AssetInventoryInformation.asset_id == AssetMaster.id,
                        AssetInventoryInformation.inventory_count == inv_n,
                    )
                    .correlate(AssetMaster)
                    .exists()
                )
        if f.get("physical_count"):
            try:
                phys_n = int(f["physical_count"])
            except ValueError:
                base = base.where(false())
            else:
                base = base.where(
                    select(1)
                    .select_from(AssetInventoryInformation)
                    .where(
                        AssetInventoryInformation.asset_id == AssetMaster.id,
                        AssetInventoryInformation.physical_count == phys_n,
                    )
                    .correlate(AssetMaster)
                    .exists()
                )
        if f.get("last_verification_date"):
            base = base.where(
                select(1)
                .select_from(AssetInventoryInformation)
                .where(
                    AssetInventoryInformation.asset_id == AssetMaster.id,
                    cast(AssetInventoryInformation.last_verification_date, String).like(
                        f"{f['last_verification_date']}%"
                    ),
                )
                .correlate(AssetMaster)
                .exists()
            )
        if f.get("created_at"):
            base = base.where(cast(AssetMaster.created_at, String).like(f"{f['created_at']}%"))
        if f.get("source_type"):
            base = base.where(AssetMaster.source_type == f["source_type"].lower())
        if f.get("physical_order_status"):
            base = self._apply_physical_order_status_filter(base, f["physical_order_status"])
        return base

    def _count_asset_rows(self, stmt: Any) -> int:
        """Count assets for a filtered list query.

        Avoid ``select(count).select_from(stmt.subquery())`` — ORM selects with
        correlated EXISTS (column filters) raise auto-correlation / empty FROM
        when nested as a subquery.
        """
        return int(
            self._db.scalar(
                stmt.with_only_columns(func.count(func.distinct(AssetMaster.id))).order_by(None)
            )
            or 0
        )

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
        column_filters: dict[str, str] | None = None,
        viewer_scope: ViewerOrgScope | None = None,
        search_columns: list[str] | None = None,
    ) -> tuple[Any, str, VerificationWindow | None, dict[str, int] | None, set[int] | None, int | None, int | None]:
        scope = viewer_scope or ViewerOrgScope(None, None, None)
        if plant_id is not None and scope.plant_ids is not None and int(plant_id) not in scope.plant_ids:
            plant_id = -1  # force empty via impossible plant
        if plant_id is not None and scope.cost_center_keys is not None:
            allowed_plants = {pid for pid, _ in scope.cost_center_keys}
            if allowed_plants and int(plant_id) not in allowed_plants:
                plant_id = -1

        fy_mode, _current_period, scan_window, fy_summary, verified_ids = self._asset_list_context(
            search=search,
            plant_id=None if plant_id == -1 else plant_id,
            category_id=category_id,
            fy_verification=fy_verification,
            fy_start_year=fy_start_year,
            fy_scan_from=fy_scan_from,
            fy_scan_to=fy_scan_to,
            search_columns=search_columns,
        )
        base = select(AssetMaster).where(AssetMaster.deleted_at.is_(None))
        if plant_id == -1:
            base = base.where(false())
            return (
                base,
                fy_mode,
                scan_window,
                fy_summary,
                verified_ids,
                None,
                None,
            )
        if search:
            match = asset_global_search_clause(search, search_columns)
            if match is not None:
                base = base.where(match)
        if category_id is not None:
            base = base.where(AssetMaster.asset_category_id == category_id)
        base = self._apply_column_filters(base, column_filters)
        if lifecycle_status:
            ls = lifecycle_status.strip().lower()
            if ls == LIFECYCLE_INACTIVE:
                base = base.where(AssetMaster.lifecycle_status.in_(tuple(LIFECYCLE_INACTIVE_FILTER)))
            else:
                base = base.where(AssetMaster.lifecycle_status == lifecycle_status)
        if approval_status:
            as_ = approval_status.strip().lower()
            base = base.where(AssetMaster.approval_status == as_)
            if as_ == APPROVAL_APPROVED and not (lifecycle_status or "").strip():
                base = base.where(
                    func.lower(AssetMaster.lifecycle_status).notin_(
                        tuple(APPROVED_LIST_HIDDEN_LIFECYCLES)
                    )
                )
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
        elif scope.plant_ids is not None and scope.cost_center_keys is None:
            _ensure_location_join()
            base = base.where(AssetLocationInformation.plant_id.in_(scope.plant_ids))

        if scope.cost_center_keys is not None:
            _ensure_location_join()
            _ensure_financial_join()
            if not scope.cost_center_keys:
                base = base.where(false())
            else:
                base = base.where(
                    tuple_(
                        AssetLocationInformation.plant_id,
                        AssetFinancialInformation.cost_center,
                    ).in_(list(scope.cost_center_keys))
                )

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
            rfid_summary_tagged = self._count_asset_rows(base.where(has_rfid))
            rfid_summary_not_tagged = self._count_asset_rows(base.where(no_rfid))
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
        column_filters: dict[str, str] | None = None,
        viewer_user_id: int | None = None,
    ) -> AssetListResponse:
        page = max(1, page)
        page_size = min(max(1, page_size), 100)
        from modules.transfers.service import sync_open_transfer_asset_lifecycles

        sync_open_transfer_asset_lifecycles(self._db)
        scope = load_viewer_org_scope(self._db, viewer_user_id)
        search_columns = (
            self.get_asset_list_columns(viewer_user_id) if viewer_user_id is not None else None
        )
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
            column_filters=column_filters,
            viewer_scope=list_viewer_scope(
                scope, view_all=self._can_view_all_assets(viewer_user_id)
            ),
            search_columns=search_columns,
        )
        current_period = financial_year_period_for()
        fy_mode = (fy_verification or "").strip().lower()
        fy_period = (
            resolve_financial_year_period(fy_start_year)
            if fy_mode in {"verified", "pending", "all"}
            else None
        )
        total = self._count_asset_rows(base)
        base = base.options(
            selectinload(AssetMaster.category),
            selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
            selectinload(AssetMaster.financial),
            selectinload(AssetMaster.inventory),
        )

        base = _apply_asset_list_sort(base, sort_by=sort_by, sort_dir=sort_dir)

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
        approvable_ids: set[int] = set()
        if viewer_user_id is not None:
            pending_row_ids = [
                int(a.id)
                for a in rows
                if (a.approval_status or "").strip().lower() == APPROVAL_PENDING
            ]
            if pending_row_ids:
                approvable_ids = self._asset_ids_viewer_can_approve(
                    pending_row_ids, viewer_user_id=int(viewer_user_id)
                )
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
                    combined_asset_number=a.combined_asset_number,
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
                    asset_custodian_id=int(a.asset_custodian_id) if a.asset_custodian_id else None,
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
                    action_allowed=asset_in_scope(a, scope),
                    can_approve=int(a.id) in approvable_ids,
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
        viewer_user_id: int | None = None,
        file_format: str = "xlsx",
        report_title: str | None = None,
        financial_year: str | None = None,
    ) -> tuple[bytes, str, str]:
        from modules.assets.export import build_asset_export_pdf, build_asset_export_xlsx
        from modules.assets.field_definitions import ASSET_EXPORT_FIELDS
        from modules.reports.export import actor_display_name, report_filename

        allowed = set(ASSET_EXPORT_FIELDS)
        export_fields = [f for f in fields if f in allowed]
        if not export_fields:
            raise ConflictError("Select at least one valid export field.")

        scope = list_viewer_scope(
            load_viewer_org_scope(self._db, viewer_user_id),
            view_all=self._can_view_all_assets(viewer_user_id),
        )
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
            viewer_scope=scope,
        )
        base = base.options(
            selectinload(AssetMaster.category),
            selectinload(AssetMaster.tag_color),
            selectinload(AssetMaster.asset_custodian),
            selectinload(AssetMaster.asset_condition),
            selectinload(AssetMaster.asset_class_master),
            selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
            selectinload(AssetMaster.financial),
            selectinload(AssetMaster.inventory),
        )

        base = _apply_asset_list_sort(base, sort_by=sort_by, sort_dir=sort_dir)

        rows = list(self._db.scalars(base.limit(max_rows)).unique().all())
        fmt = file_format.lower()
        generated_by = actor_display_name(self._db, viewer_user_id)
        fy_token = financial_year
        if fy_token is None and fy_start_year is not None:
            fy_token = str(fy_start_year)
        title = report_title or ("Asset Register" if fmt == "pdf" else "Asset Register")
        if fmt == "pdf":
            content = build_asset_export_pdf(rows, export_fields, generated_by=generated_by)
            filename = report_filename(
                "asset_register",
                "pdf",
                report_name=title,
                financial_year=fy_token,
            )
            return content, filename, "application/pdf"
        content = build_asset_export_xlsx(rows, export_fields, generated_by=generated_by)
        filename = report_filename(
            "asset_register",
            "xlsx",
            report_name=title,
            financial_year=fy_token,
        )
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
        generated_by_user_id: int | None = None,
    ) -> tuple[bytes, str, str]:
        from modules.reports.export import (
            ReportDocument,
            actor_display_name,
            build_pdf,
            build_xlsx,
            content_type_for_format,
            report_filename,
        )

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
            generated_by=actor_display_name(self._db, generated_by_user_id),
        )
        normalized = (fmt or "xlsx").strip().lower()
        if normalized == "pdf":
            content = build_pdf(doc)
        else:
            content = build_xlsx(doc)
            normalized = "xlsx"
        filename = report_filename(
            "financial_year_verification",
            normalized,
            report_name="Financial Year Physical Verification",
            financial_year=res.financial_year_label or (str(fy_start_year) if fy_start_year else None),
        )
        return content, filename, content_type_for_format(normalized)

    def get_asset(
        self, asset_id: int, *, viewer_user_id: int | None = None
    ) -> AssetDetailPublic:
        from modules.transfers.service import sync_open_transfer_asset_lifecycles

        sync_open_transfer_asset_lifecycles(self._db)
        asset = self._load_asset(asset_id)
        self._assert_asset_in_viewer_scope(asset, viewer_user_id=viewer_user_id)
        return self._to_detail(asset, viewer_user_id=viewer_user_id)

    def _assert_asset_in_viewer_scope(
        self, asset: AssetMaster, *, viewer_user_id: int | None
    ) -> None:
        scope = list_viewer_scope(
            load_viewer_org_scope(self._db, viewer_user_id),
            view_all=self._can_view_all_assets(viewer_user_id),
        )
        if not asset_in_scope(asset, scope):
            raise NotFoundError("Asset", int(asset.id))

    def _can_view_all_assets(self, user_id: int | None) -> bool:
        if user_id is None:
            return False
        codes = set(get_flat_permission_codes_for_user(self._db, user_id))
        return bool(codes & {"asset.view_all", "asset:view_all"})

    def _assert_asset_action_allowed(
        self, asset: AssetMaster, *, actor_user_id: int | None
    ) -> None:
        scope = load_viewer_org_scope(self._db, actor_user_id)
        if not asset_in_scope(asset, scope):
            raise PermissionDeniedError(
                "You can only change assets in your assigned cost centers."
            )

    def _load_asset(self, asset_id: int) -> AssetMaster:
        asset = self._db.scalar(
            select(AssetMaster)
            .where(AssetMaster.id == asset_id, AssetMaster.deleted_at.is_(None))
            .options(
                selectinload(AssetMaster.category),
                selectinload(AssetMaster.tag_color),
                selectinload(AssetMaster.asset_custodian),
                selectinload(AssetMaster.asset_condition),
            selectinload(AssetMaster.asset_class_master),
                selectinload(AssetMaster.location).selectinload(AssetLocationInformation.plant),
                selectinload(AssetMaster.information),
                selectinload(AssetMaster.financial),
                selectinload(AssetMaster.inventory),
            )
        )
        if asset is None:
            raise NotFoundError("Asset", asset_id)
        return asset

    def _workflow_runs_for_request(self, req: Any) -> list[AssetWorkflowRunPublic]:
        from modules.platform.approvals.model import ApprovalRequest
        from modules.platform.tasks.service import (
            _build_workflow_steps_for_request,
            _split_approval_task_runs,
        )

        assert isinstance(req, ApprovalRequest)
        out: list[AssetWorkflowRunPublic] = []
        wf_step_ids = {int(s.id) for s in (req.workflow.steps if req.workflow else [])}
        live_tasks = [
            t
            for t in (req.tasks or [])
            if t.step_id is not None and int(t.step_id) in wf_step_ids
        ]
        live_runs = _split_approval_task_runs(live_tasks)
        for idx, run_tasks in enumerate(live_runs):
            is_last = idx == len(live_runs) - 1
            has_reject = any(str(t.status).lower() == "rejected" for t in run_tasks)
            if is_last and str(req.status).lower() == "pending" and not has_reject:
                status_override = None
            elif has_reject:
                status_override = "rejected"
            elif is_last:
                status_override = str(req.status)
            else:
                status_override = "rejected"
            step_rows = _build_workflow_steps_for_request(
                self._db,
                req,
                tasks=run_tasks,
                status_override=status_override,
            )
            out.append(
                AssetWorkflowRunPublic(
                    attempt=len(out) + 1,
                    request_id=int(req.id),
                    request_status=status_override or str(req.status),
                    is_current=is_last,
                    workflow_steps=step_rows,
                )
            )
        if out and not any(r.is_current for r in out):
            out[-1].is_current = True
        return out

    def _approval_panel(
        self, asset: AssetMaster, *, viewer_user_id: int | None
    ) -> AssetApprovalPanel | None:
        from modules.platform.approvals.model import ApprovalRequest, ApprovalTask, ApprovalWorkflow
        from modules.platform.roles.model import Role

        req = find_latest_asset_approval_request(self._db, asset_id=int(asset.id))
        if req is None:
            return None

        req = self._db.scalar(
            select(ApprovalRequest)
            .where(ApprovalRequest.id == int(req.id))
            .options(
                selectinload(ApprovalRequest.workflow).selectinload(ApprovalWorkflow.steps),
                selectinload(ApprovalRequest.tasks).options(
                    selectinload(ApprovalTask.step),
                    selectinload(ApprovalTask.actions),
                ),
            )
        )
        if req is None:
            return None

        workflow_runs = self._workflow_runs_for_request(req)
        steps = workflow_runs[-1].workflow_steps if workflow_runs else []

        role_ids: set[int] = set()
        if viewer_user_id is not None:
            role_ids = ApprovalEngineService(self._db)._role_ids_for_user(int(viewer_user_id))

        my_pending: int | None = None
        pending_task: ApprovalTask | None = None
        for t in req.tasks or []:
            if str(t.task_type) != "approval":
                continue
            if str(t.status).lower() != "pending":
                continue
            pending_task = t
            if viewer_user_id is not None:
                if t.assigned_user_id is not None:
                    if int(t.assigned_user_id) == int(viewer_user_id):
                        my_pending = int(t.id)
                elif t.assigned_role_id is not None and int(t.assigned_role_id) in role_ids:
                    my_pending = int(t.id)
            break

        current_role: str | None = None
        current_assignee_id: int | None = None
        current_assignee_name: str | None = None
        if pending_task is not None:
            if pending_task.assigned_user_id is not None:
                current_assignee_id = int(pending_task.assigned_user_id)
                u = self._db.get(User, current_assignee_id)
                current_assignee_name = (
                    (u.full_name or u.email or f"User #{current_assignee_id}")
                    if u is not None
                    else f"User #{current_assignee_id}"
                )
            if pending_task.step is not None:
                role = self._db.get(Role, int(pending_task.step.approver_role_id))
                if role is not None:
                    current_role = role.name

        is_final = True
        if str(req.status) == "pending" and steps:
            current = next((s for s in steps if s.phase == "current"), None)
            if current is not None:
                is_final = int(current.step_order) >= int(current.total_steps)

        return AssetApprovalPanel(
            request_id=int(req.id),
            request_status=str(req.status),
            workflow_steps=steps,
            workflow_runs=workflow_runs,
            my_pending_task_id=my_pending,
            pending_task_id=int(pending_task.id) if pending_task is not None else None,
            current_assignee_user_id=current_assignee_id,
            current_assignee_name=current_assignee_name,
            current_step_role_name=current_role,
            is_final_step=is_final,
        )

    def _to_detail(
        self, asset: AssetMaster, *, viewer_user_id: int | None = None
    ) -> AssetDetailPublic:
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
        from modules.capex.model import CapitalizationForm

        linked_capex = self._db.scalar(
            select(CapitalizationForm).where(CapitalizationForm.asset_id == int(asset.id))
        )
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
            combined_asset_number=asset.combined_asset_number,
            remark=asset.remark,
            sub_no=asset.sub_no,
            rfid_code=asset.rfid_code,
            serial_no=asset.serial_no,
            asset_category_id=asset.asset_category_id,
            asset_class=asset.asset_class_master.name
            if asset.asset_class_master
            else asset.asset_class,
            asset_class_id=asset.asset_class_id,
            asset_class_code=asset.asset_class_master.code if asset.asset_class_master else None,
            asset_class_name=asset.asset_class_master.name if asset.asset_class_master else None,
            asset_type=asset.asset_type,
            category_name=asset.category.name if asset.category else None,
            tag_color_id=asset.tag_color_id,
            tag_color_code=asset.tag_color.code if asset.tag_color else None,
            tag_color_name=asset.tag_color.name if asset.tag_color else None,
            tag_color_hex=asset.tag_color.color_hex if asset.tag_color else None,
            asset_custodian_id=asset.asset_custodian_id,
            asset_custodian_code=asset.asset_custodian.username if asset.asset_custodian else None,
            asset_custodian_name=asset.asset_custodian.full_name if asset.asset_custodian else None,
            asset_condition_id=asset.asset_condition_id,
            asset_condition_code=asset.asset_condition.code if asset.asset_condition else None,
            asset_condition_name=asset.asset_condition.name if asset.asset_condition else None,
            lifecycle_status=asset.lifecycle_status,
            approval_status=asset.approval_status,
            ownership_type=asset.ownership_type,
            source_type=asset.source_type,
            import_batch_id=asset.import_batch_id,
            created_by=asset.created_by,
            approved_by=asset.approved_by,
            created_at=asset.created_at,
            updated_at=asset.updated_at,
            has_image=bool(asset.image_content_type),
            image_filename=asset.image_filename,
            image_content_type=asset.image_content_type,
            plant_code=loc.plant.code if loc and loc.plant else None,
            plant_name=loc.plant.name if loc and loc.plant else None,
            information=AssetInformationPayload.model_validate(info) if info else None,
            location=location_payload,
            financial=financial_payload,
            inventory=AssetInventoryPayload.model_validate(inv) if inv else None,
            financial_year_label=period.label if rfid else None,
            active_physical_order=active_order,
            fy_verification_count=fy_count,
            capitalization_form_id=int(linked_capex.id) if linked_capex is not None else None,
            capitalization_form_number=linked_capex.form_number if linked_capex is not None else None,
            capitalization_form_asset_name=linked_capex.asset_name if linked_capex is not None else None,
            approval_panel=self._approval_panel(asset, viewer_user_id=viewer_user_id),
            action_allowed=asset_in_scope(
                asset, load_viewer_org_scope(self._db, viewer_user_id)
            ),
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
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
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

    def update_asset_remark(
        self,
        asset_id: int,
        remark: str | None,
        *,
        actor_user_id: int,
    ):
        """Update only asset_master.remark and write field-level audit (who/when)."""
        from modules.assets.schema import AssetRemarkPublic

        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        if (asset.approval_status or "").strip().lower() == APPROVAL_PENDING:
            raise ConflictError("Cannot edit asset while approval is pending.")

        previous = asset.remark
        cleaned = remark.strip() if remark and remark.strip() else None
        if cleaned == (previous.strip() if previous else None) or cleaned == previous:
            return AssetRemarkPublic(
                asset_id=int(asset.id),
                remark=previous,
                previous_remark=previous,
            )

        before = snapshot_asset(asset)
        asset.remark = cleaned
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
                new_value={"changes": changes, "source": "mobile_remark"},
            )
        self._db.commit()
        return AssetRemarkPublic(
            asset_id=int(asset.id),
            remark=asset.remark,
            previous_remark=previous,
        )

    def update_asset(
        self, asset_id: int, data: AssetUpdateRequest, *, actor_user_id: int | None
    ) -> AssetDetailPublic:
        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        if (asset.approval_status or "").strip().lower() == APPROVAL_PENDING:
            raise ConflictError("Cannot edit asset while approval is pending.")

        before = snapshot_asset(asset)
        if data.asset_name is not None:
            asset.asset_name = data.asset_name.strip()
        if data.combined_asset_number is not None:
            can = data.combined_asset_number.strip().upper()
            if self._db.scalar(
                select(AssetMaster.id).where(
                    AssetMaster.combined_asset_number == can,
                    AssetMaster.id != asset.id,
                    AssetMaster.deleted_at.is_(None),
                )
            ):
                raise DuplicateCombinedAssetNumberError()
            asset.combined_asset_number = can
        if data.asset_code is not None:
            asset.asset_code = data.asset_code.strip().upper()
        if "remark" in data.model_dump(exclude_unset=True):
            asset.remark = (data.remark.strip() if data.remark and data.remark.strip() else None)
        if "sub_no" in data.model_dump(exclude_unset=True):
            asset.sub_no = (data.sub_no.strip() if data.sub_no and data.sub_no.strip() else None)
        if "rfid_code" in data.model_dump(exclude_unset=True):
            rfid = _normalize_rfid(data.rfid_code or "") or None
            if rfid:
                _assert_rfid_available(self._db, rfid=rfid, exclude_asset_id=asset.id)
            asset.rfid_code = rfid
            if not rfid:
                asset.tag_color_id = None
        if "tag_color_id" in data.model_dump(exclude_unset=True):
            self._set_tag_color(asset, data.tag_color_id)
        if "asset_custodian_id" in data.model_dump(exclude_unset=True):
            self._set_asset_custodian(asset, data.asset_custodian_id)
        if "asset_condition_id" in data.model_dump(exclude_unset=True):
            self._set_asset_condition(asset, data.asset_condition_id)
        if "asset_class_id" in data.model_dump(exclude_unset=True):
            self._set_asset_class(asset, data.asset_class_id)
        elif data.asset_class is not None:
            # Legacy free-text update: resolve to master when possible.
            text = data.asset_class.strip() or None
            if text:
                class_id = self._resolve_asset_class_id(asset_class_id=None, asset_class_code=text)
                self._set_asset_class(asset, class_id)
            else:
                self._set_asset_class(asset, None)
        if data.serial_no is not None:
            asset.serial_no = data.serial_no.strip() or None
        if data.asset_category_id is not None:
            asset.asset_category_id = data.asset_category_id
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

        if "capitalization_form_id" in data.model_fields_set:
            from modules.capex.service import CapexFormService

            capex_svc = CapexFormService(self._db)
            if data.capitalization_form_id is None:
                capex_svc.unlink_from_asset(asset_id=int(asset.id), actor_user_id=actor_user_id)
            else:
                capex_svc.link_to_asset(
                    int(data.capitalization_form_id),
                    asset_id=int(asset.id),
                    actor_user_id=actor_user_id,
                    asset_code=asset.asset_code,
                )

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
        # CapEx link changes are audited on the form; also note on asset when only the link changed.
        if "capitalization_form_id" in data.model_fields_set and not changes:
            log_asset_event(
                self._db,
                asset_id=asset.id,
                actor_user_id=actor_user_id,
                action="updated",
                old_value=before,
                new_value={"capitalization_form_id": data.capitalization_form_id},
            )
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            if "rfid" in str(exc).lower():
                raise DuplicateRfidError() from exc
            raise DuplicateAssetCodeError() from exc

        self._log_rework_asset_update_if_any(
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            before_snapshot=before,
            after_asset=self._load_asset(asset.id),
        )
        return self.get_asset(asset.id, viewer_user_id=actor_user_id)

    def _log_rework_asset_update_if_any(
        self,
        *,
        asset_id: int,
        actor_user_id: int | None,
        before_snapshot: dict[str, Any],
        after_asset: AssetMaster,
    ) -> None:
        """Record edits on an open rework task. Do not auto-resubmit — user picks assignee via Submit."""
        if actor_user_id is None:
            return
        after_snapshot = snapshot_asset(after_asset)
        if not diff_snapshots(before_snapshot, after_snapshot):
            return
        req = find_open_asset_approval_request(self._db, asset_id=asset_id)
        if req is None:
            return
        rework_task_id = self._db.scalar(
            select(ApprovalTask.id).where(
                ApprovalTask.request_id == req.id,
                ApprovalTask.task_type == "rework",
                ApprovalTask.status.in_(("open", "pending")),
            )
        )
        if rework_task_id is None:
            return
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

    def _assert_asset_not_on_open_order(self, asset: AssetMaster) -> None:
        """Block delete/deactivate while the asset is on an open order."""
        if is_pending_transfer(asset.lifecycle_status):
            raise ConflictError(
                f"Asset {asset.asset_code} is on an open transfer and cannot be deleted or deactivated."
            )
        if is_pending_disposal(asset.lifecycle_status):
            raise ConflictError(
                f"Asset {asset.asset_code} is on an open disposal and cannot be deleted or deactivated."
            )
        open_orders = self._orders_for_assets_by_status([int(asset.id)], ACTIVE_ORDER_STATUSES)
        info = open_orders.get(int(asset.id))
        if info is not None:
            raise ConflictError(
                f"Asset {asset.asset_code} is on open physical order {info.order_number} "
                "and cannot be deleted or deactivated."
            )

    def soft_delete(self, asset_id: int, *, actor_user_id: int | None) -> None:
        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        self._assert_asset_not_on_open_order(asset)
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

    def deactivate(self, asset_id: int, *, actor_user_id: int | None) -> AssetDetailPublic:
        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        self._assert_asset_not_on_open_order(asset)
        if not can_deactivate(asset):
            raise ConflictError(
                f"Asset {asset.asset_code} cannot be deactivated "
                "(only active assets that are not pending approval)."
            )
        change = set_asset_deactivated(asset)
        asset.updated_at = _now()
        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="deactivated",
            old_value=change["before"],
            new_value=change["after"],
        )
        self._db.commit()
        return self.get_asset(asset_id, viewer_user_id=actor_user_id)

    def reactivate(self, asset_id: int, *, actor_user_id: int | None) -> AssetDetailPublic:
        asset = self._load_asset(asset_id)
        self._assert_asset_action_allowed(asset, actor_user_id=actor_user_id)
        if not can_reactivate(asset):
            raise ConflictError(
                f"Asset {asset.asset_code} cannot be reactivated "
                "(only previously deactivated assets)."
            )
        change = set_asset_reactivated(asset)
        asset.updated_at = _now()
        log_asset_event(
            self._db,
            asset_id=asset.id,
            actor_user_id=actor_user_id,
            action="reactivated",
            old_value=change["before"],
            new_value=change["after"],
        )
        self._db.commit()
        return self.get_asset(asset_id, viewer_user_id=actor_user_id)

    def bulk_lifecycle(
        self,
        asset_ids: list[int],
        *,
        actor_user_id: int,
        action: str,
    ):
        from modules.assets.schema import AssetBulkLifecycleResponse

        act = (action or "").strip().lower()
        if act not in ("deactivate", "reactivate"):
            raise ConflictError("action must be deactivate or reactivate.")

        processed = 0
        errors: list[str] = []
        seen: set[int] = set()
        for raw_id in asset_ids:
            aid = int(raw_id)
            if aid in seen:
                continue
            seen.add(aid)
            try:
                if act == "deactivate":
                    self.deactivate(aid, actor_user_id=actor_user_id)
                else:
                    self.reactivate(aid, actor_user_id=actor_user_id)
                processed += 1
            except NotFoundError:
                errors.append(f"Asset #{aid}: not found.")
            except PermissionDeniedError as exc:
                errors.append(str(exc))
            except ConflictError as exc:
                errors.append(str(exc))
            except Exception as exc:
                errors.append(f"Asset #{aid}: {exc}")
        return AssetBulkLifecycleResponse(processed_count=processed, errors=errors)

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
            elif ev.action == "reassigned":
                change_rows = [
                    AssetAuditChangeLine(
                        field_label="Approver",
                        from_value=str(ov.get("assignee_name") or "—"),
                        to_value=str(nv.get("assignee_name") or "—"),
                    )
                ]
            elif ev.action == "rejected" and str(nv.get("comment") or "").strip():
                change_rows = [
                    AssetAuditChangeLine(
                        field_label="Reason",
                        from_value="—",
                        to_value=str(nv.get("comment")).strip(),
                    )
                ]
            elif ev.action == "approved" and str(nv.get("comment") or "").strip():
                change_rows = [
                    AssetAuditChangeLine(
                        field_label="Comment",
                        from_value="—",
                        to_value=str(nv.get("comment")).strip(),
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
                can = mapped.get("combined_asset_number") or ""
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
                        AssetMaster.combined_asset_number == str(can).strip().upper(),
                        AssetMaster.deleted_at.is_(None),
                    )
                ):
                    errors.append(f"Row {raw.row_number}: duplicate Combined Asset No.")
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
                try:
                    asset_custodian_id = self._resolve_asset_custodian_id(
                        asset_custodian_id=None,
                        asset_custodian_code=str(mapped.get("asset_custodian_code") or "") or None,
                    )
                    asset_condition_id = self._resolve_asset_condition_id(
                        asset_condition_id=None,
                        asset_condition_code=str(mapped.get("asset_condition_code") or "") or None,
                    )
                    asset_class_id = self._resolve_asset_class_id(
                        asset_class_id=None,
                        asset_class_code=str(mapped.get("asset_class_code") or "") or None,
                    )
                except InvalidAssetMasterLookupError as exc:
                    errors.append(f"Row {raw.row_number}: {exc.message}")
                    continue
                asset = AssetMaster(
                    asset_name=str(name).strip(),
                    asset_code=str(code).strip().upper(),
                    combined_asset_number=str(can).strip().upper(),
                    remark=(str(mapped.get("remark") or "").strip() or None),
                    sub_no=(str(mapped.get("sub_no") or "").strip() or None),
                    rfid_code=mapped.get("rfid_code"),
                    serial_no=mapped.get("serial_no"),
                    asset_category_id=cat_id,
                    asset_type=mapped.get("asset_type"),
                    tag_color_id=tag_color_id if rfid else None,
                    asset_custodian_id=asset_custodian_id,
                    asset_condition_id=asset_condition_id,
                    ownership_type=str(raw.data.get("ownership_type") or "").strip() or None,
                    source_type="import",
                    import_batch_id=batch.id,
                    created_by=actor_user_id,
                )
                if asset_class_id is not None:
                    self._set_asset_class(asset, asset_class_id)
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

                capex_form_id = raw.data.get("capitalization_form_id")
                if capex_form_id is not None:
                    from modules.capex.service import CapexFormService

                    try:
                        CapexFormService(self._db).link_to_asset(
                            int(capex_form_id),
                            asset_id=int(asset.id),
                            actor_user_id=actor_user_id,
                            asset_code=str(code).strip().upper() or None,
                        )
                    except ConflictError as exc:
                        # Asset already persisted; surface link failure without dropping the row.
                        errors.append(f"Row {raw.row_number}: CapEx link failed: {exc}")
                        capex_form_id = None

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
                        "capitalization_form_id": (
                            int(capex_form_id) if capex_form_id is not None else None
                        ),
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


def activate_asset_after_approval(
    db: Session,
    *,
    asset_id: int,
    approver_user_id: int | None,
    comment: str | None = None,
) -> None:
    asset = db.get(AssetMaster, asset_id)
    if asset is None:
        return
    transition = set_asset_approved_active(asset, approver_user_id=approver_user_id)
    note = (comment or "").strip() or None
    # Single audit entry: approval also activates the asset — no separate "activated" row.
    log_asset_event(
        db,
        asset_id=asset.id,
        actor_user_id=approver_user_id,
        action="approved",
        old_value=transition["before"],
        new_value={
            "source": asset.source_type,
            **transition["after"],
            **({"comment": note} if note else {}),
        },
    )


def reject_asset_after_approval(
    db: Session,
    *,
    asset_id: int,
    approver_user_id: int | None,
    comment: str | None = None,
) -> None:
    asset = db.get(AssetMaster, asset_id)
    if asset is None:
        return
    transition = set_asset_rejected_inactive(asset)
    note = (comment or "").strip() or None
    log_asset_event(
        db,
        asset_id=asset.id,
        actor_user_id=approver_user_id,
        action="rejected",
        section="workflow",
        old_value=transition["before"],
        new_value={
            **transition["after"],
            **({"comment": note} if note else {}),
        },
    )
