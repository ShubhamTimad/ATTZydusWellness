from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from modules.assets.field_definitions import normalize_asset_number_field
from modules.platform.tasks.schema import TaskApprovalStepLinePublic


class AssetCategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None = None
    is_active: bool


class AssetCustodianUserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    email: str | None = None


class AssetInformationPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    inventory_no: str | None = None
    asset_description: str | None = None
    engineering_description: str | None = None
    qa_description: str | None = None
    asset_allocation: str | None = None
    pm_equipment_id: str | None = None


class AssetLocationPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    plant_id: int | None = None
    sub_location: str | None = None
    functional_location: str | None = None
    functional_location_name: str | None = None
    actual_location: str | None = None
    actual_location_name: str | None = None
    building: str | None = None
    floor: str | None = None
    room: str | None = None
    zone: str | None = None


class AssetFinancialPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cost_center: str | None = None
    cost_center_name: str | None = None
    laboratory: str | None = None
    profit_center: str | None = None
    profit_center_name: str | None = None
    cap_date: date | None = None
    gross_block: Decimal | None = Field(default=None, ge=0)
    party_details: str | None = None
    invoice_no: str | None = None
    invoice_date: date | None = None
    voucher_no: str | None = None
    voucher_date: date | None = None
    grn_no: str | None = None
    grn_date: date | None = None
    put_to_use_date: date | None = None
    depreciation_rate: Decimal | None = Field(default=None, ge=0)
    life_span: str | None = None
    vendor_name: str | None = None
    po_number: str | None = None
    currency: str | None = None


class AssetInventoryPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    inventory_count: int | None = Field(default=None, ge=0)
    physical_count: int | None = Field(default=None, ge=0)
    last_verification_date: date | None = None
    verification_status: str | None = None
    verification_remarks: str | None = None


class AssetCreateRequest(BaseModel):
    asset_name: str = Field(min_length=1, max_length=255)
    asset_code: str | None = Field(default=None, max_length=128)
    combined_asset_number: str = Field(min_length=1, max_length=128)
    remark: str | None = Field(default=None)
    sub_no: str | None = Field(default=None, max_length=64)
    rfid_code: str | None = Field(default=None, max_length=128)
    serial_no: str | None = Field(default=None, max_length=128)
    asset_class: str | None = Field(default=None, max_length=128)
    asset_class_id: int | None = None
    asset_type: str | None = Field(default=None, max_length=128)
    asset_category_id: int | None = None
    tag_color_id: int | None = None
    asset_custodian_id: int | None = None
    asset_condition_id: int | None = None
    ownership_type: str | None = Field(default=None, max_length=64)
    capitalization_form_id: int | None = None
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None

    @field_validator("asset_code", "combined_asset_number", mode="before")
    @classmethod
    def _asset_numbers_no_special(cls, value: object) -> str | None:
        if value is None:
            return None
        return normalize_asset_number_field(str(value))


class AssetUpdateRequest(BaseModel):
    asset_name: str | None = Field(default=None, min_length=1, max_length=255)
    asset_code: str | None = Field(default=None, max_length=128)
    combined_asset_number: str | None = Field(default=None, min_length=1, max_length=128)
    remark: str | None = None
    sub_no: str | None = Field(default=None, max_length=64)
    rfid_code: str | None = None
    serial_no: str | None = None
    asset_class: str | None = Field(default=None, max_length=128)
    asset_class_id: int | None = None
    asset_type: str | None = Field(default=None, max_length=128)
    asset_category_id: int | None = None
    tag_color_id: int | None = None
    asset_custodian_id: int | None = None
    asset_condition_id: int | None = None
    ownership_type: str | None = None
    lifecycle_status: str | None = None
    capitalization_form_id: int | None = None
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None

    @field_validator("asset_code", "combined_asset_number", mode="before")
    @classmethod
    def _asset_numbers_no_special(cls, value: object) -> str | None:
        if value is None:
            return None
        return normalize_asset_number_field(str(value))

class AssetRfidAttachRequest(BaseModel):
    rfid_code: str = Field(..., min_length=1, max_length=128)
    tag_color_id: int | None = None


class AssetRemarkUpdateRequest(BaseModel):
    remark: str | None = Field(default=None, max_length=4000)


class AssetRemarkPublic(BaseModel):
    asset_id: int
    remark: str | None
    previous_remark: str | None


class AssetImagePublic(BaseModel):
    has_image: bool
    image_filename: str | None = None
    image_content_type: str | None = None


class AssetRfidAttachByCodeRequest(BaseModel):
    asset_code: str = Field(..., min_length=1, max_length=128)
    rfid_code: str = Field(..., min_length=1, max_length=128)
    tag_color_id: int | None = None


# Alias for existing clients
class AssetRfidUpdateRequest(AssetRfidAttachRequest):
    pass


class AssetRfidAttachPublic(BaseModel):
    asset_id: int
    asset_code: str
    asset_name: str
    rfid_code: str
    previous_rfid_code: str | None
    operation: Literal["attached", "updated"]
    tag_color_id: int | None = None
    tag_color_code: str | None = None
    tag_color_name: str | None = None
    tag_color_hex: str | None = None
    asset_custodian_id: int | None = None
    asset_custodian_code: str | None = None
    asset_custodian_name: str | None = None
    asset_condition_id: int | None = None
    asset_condition_code: str | None = None
    asset_condition_name: str | None = None

class AssetActivePhysicalOrderPublic(BaseModel):
    order_id: int
    order_number: str
    order_status: str
    closed_at: datetime | None = None
    has_closure_workflow: bool = False


class AssetListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_name: str
    asset_code: str
    combined_asset_number: str | None = None
    rfid_code: str | None = None
    category_name: str | None = None
    plant_id: int | None = None
    plant_code: str | None = None
    plant_name: str | None = None
    functional_location: str | None = None
    functional_location_description: str | None = None
    actual_location: str | None = None
    actual_location_description: str | None = None
    cost_center: str | None = None
    cost_center_description: str | None = None
    asset_custodian_id: int | None = None
    inventory_count: int | None = None
    physical_count: int | None = None
    last_verification_date: date | None = None
    fy_verified: bool | None = None
    fy_verification_count: int | None = None
    lifecycle_status: str
    approval_status: str
    source_type: str
    created_at: datetime
    active_physical_order: AssetActivePhysicalOrderPublic | None = None
    action_allowed: bool = True
    # True when the viewer has a pending approval task for this asset (user or role).
    can_approve: bool = False


class AssetListResponse(BaseModel):
    items: list[AssetListItem]
    total: int
    page: int
    page_size: int
    financial_year_label: str | None = None
    financial_year_start: date | None = None
    financial_year_end: date | None = None
    financial_year_start_year: int | None = None
    financial_year_is_current: bool | None = None
    scan_window_start: date | None = None
    scan_window_end: date | None = None
    total_fy_verification_events: int | None = None
    verified_assets_total: int | None = None
    pending_assets_total: int | None = None
    total_rfid_assets: int | None = None
    rfid_tagged_total: int | None = None
    rfid_not_tagged_total: int | None = None


class AssetListColumnsPreference(BaseModel):
    columns: list[str]


class AssetListFilterOption(BaseModel):
    code: str
    name: str | None = None


class AssetListFilterOptionsResponse(BaseModel):
    """Distinct column-filter values from assets visible in the list scope."""

    cost_centers: list[AssetListFilterOption] = Field(default_factory=list)
    functional_locations: list[AssetListFilterOption] = Field(default_factory=list)
    actual_locations: list[AssetListFilterOption] = Field(default_factory=list)
    # Assigned to the viewer (action scope). Used to default the CC filter when view_all.
    assigned_cost_centers: list[AssetListFilterOption] = Field(default_factory=list)


class FinancialYearOptionPublic(BaseModel):
    label: str
    start: date
    end: date
    start_year: int
    is_current: bool


class FinancialYearListResponse(BaseModel):
    items: list[FinancialYearOptionPublic]
    current_start_year: int


class AssetDetailPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_name: str
    asset_code: str
    combined_asset_number: str
    remark: str | None = None
    sub_no: str | None = None
    rfid_code: str | None
    serial_no: str | None
    asset_category_id: int | None
    asset_class: str | None = None
    asset_class_id: int | None = None
    asset_class_code: str | None = None
    asset_class_name: str | None = None
    asset_type: str | None = None
    category_name: str | None = None
    tag_color_id: int | None = None
    tag_color_code: str | None = None
    tag_color_name: str | None = None
    tag_color_hex: str | None = None
    asset_custodian_id: int | None = None
    asset_custodian_code: str | None = None
    asset_custodian_name: str | None = None
    asset_condition_id: int | None = None
    asset_condition_code: str | None = None
    asset_condition_name: str | None = None
    lifecycle_status: str
    approval_status: str
    ownership_type: str | None
    source_type: str
    import_batch_id: int | None
    created_by: int | None
    approved_by: int | None
    created_at: datetime
    updated_at: datetime
    has_image: bool = False
    image_filename: str | None = None
    image_content_type: str | None = None
    plant_code: str | None = None
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None
    plant_name: str | None = None
    financial_year_label: str | None = None
    fy_verification_count: int | None = None
    active_physical_order: AssetActivePhysicalOrderPublic | None = None
    capitalization_form_id: int | None = None
    capitalization_form_number: str | None = None
    capitalization_form_asset_name: str | None = None
    approval_panel: AssetApprovalPanel | None = None
    action_allowed: bool = True


class AssetWorkflowRunPublic(BaseModel):
    attempt: int
    request_id: int
    request_status: str
    is_current: bool = False
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)


class AssetApprovalPanel(BaseModel):
    """Approval timeline + viewer action context for asset detail."""

    request_id: int
    request_status: str
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)
    workflow_runs: list[AssetWorkflowRunPublic] = Field(default_factory=list)
    my_pending_task_id: int | None = None
    pending_task_id: int | None = None
    current_assignee_user_id: int | None = None
    current_assignee_name: str | None = None
    current_step_role_name: str | None = None
    is_final_step: bool = False


class AssetAssigneeOption(BaseModel):
    id: int
    full_name: str
    email: str | None = None


class AssetAssigneeListResponse(BaseModel):
    role_name: str
    items: list[AssetAssigneeOption] = Field(default_factory=list)


class AssetSubmitRequest(BaseModel):
    assignee_user_id: int = Field(ge=1)


class AssetReassignRequest(BaseModel):
    assignee_user_id: int = Field(ge=1)


class AssetAuditChangeLine(BaseModel):
    field_label: str
    from_value: str
    to_value: str


class AssetAuditEventPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    actor_user_id: int | None
    actor_name: str | None = None
    activity_verb: str
    summary: str
    changes: list[AssetAuditChangeLine] = Field(default_factory=list)
    created_at: datetime


class ImportPreviewRow(BaseModel):
    row_number: int
    valid: bool
    errors: list[str] = Field(default_factory=list)
    field_errors: dict[str, str] = Field(default_factory=dict)
    duplicate_asset_code: bool = False
    duplicate_combined_asset_number: bool = False
    duplicate_rfid_code: bool = False
    data: dict[str, Any] = Field(default_factory=dict)


class ImportValidateRequest(BaseModel):
    filename: str | None = None
    rows: list[dict[str, Any]] = Field(min_length=1)


class ImportPreviewResponse(BaseModel):
    filename: str | None
    total_rows: int
    valid_rows: int
    error_rows: int
    rows: list[ImportPreviewRow]


class ImportConfirmRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1)
    filename: str | None = None
    initiate_approval: bool = False


class SubmitForApprovalRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)
    assignee_user_id: int = Field(ge=1)


class SubmitForApprovalResponse(BaseModel):
    submitted_count: int
    activated_count: int
    errors: list[str] = Field(default_factory=list)


class AssetBulkDecisionRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)
    action: str = Field(min_length=1)  # approve | reject
    comment: str = Field(min_length=1, max_length=10_000)


class AssetBulkDecisionResponse(BaseModel):
    processed_count: int
    errors: list[str] = Field(default_factory=list)


class AssetBulkLifecycleRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)
    action: str = Field(min_length=1)  # deactivate | reactivate


class AssetBulkLifecycleResponse(BaseModel):
    processed_count: int
    errors: list[str] = Field(default_factory=list)


class ImportConfirmResponse(BaseModel):
    batch_id: int
    created_count: int
    pending_approval: bool
    errors: list[str] = Field(default_factory=list)


class ImportConfirmChunkRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1)
    filename: str | None = None
    batch_id: int | None = None
    chunk_index: int = Field(ge=0)
    total_chunks: int = Field(ge=1)
    total_rows: int = Field(ge=1)
    processed_rows: int = Field(ge=0)
    is_final_chunk: bool = False
    initiate_approval: bool = False


class ImportConfirmChunkResponse(BaseModel):
    batch_id: int
    chunk_created_count: int
    chunk_error_count: int
    total_created_count: int
    processed_rows: int
    total_rows: int
    percent: float
    errors: list[str] = Field(default_factory=list)
    is_complete: bool
    pending_approval: bool = False


class ImportCancelBatchResponse(BaseModel):
    batch_id: int
    assets_removed: int


class AssetExportFieldPublic(BaseModel):
    key: str
    label: str


class AssetExportFieldsResponse(BaseModel):
    fields: list[AssetExportFieldPublic]


class AssetFieldConfigPublic(BaseModel):
    field_key: str
    display_label: str
    is_visible: bool
    is_required: bool


class AssetFieldConfigListResponse(BaseModel):
    fields: list[AssetFieldConfigPublic]
