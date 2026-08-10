from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class ValidateAssetsRequest(BaseModel):
    asset_ids: list[int] = Field(..., min_length=1)


class ActiveOrderConflict(BaseModel):
    asset_id: int
    asset_code: str
    asset_name: str
    order_id: int
    order_number: str
    order_status: str


class InvalidAssetRef(BaseModel):
    asset_id: int
    asset_code: str
    asset_name: str
    plant_id: int | None = None
    plant_name: str | None = None
    cost_center_code: str | None = None


class VerifiedInFinancialYearRef(BaseModel):
    asset_id: int
    asset_code: str
    asset_name: str
    last_verification_date: date | None = None
    physical_count: int | None = None


class ValidateAssetsResponse(BaseModel):
    eligible_asset_ids: list[int]
    active_order_conflicts: list[ActiveOrderConflict]
    missing_rfid: list[InvalidAssetRef]
    not_approved: list[InvalidAssetRef] = Field(default_factory=list)
    plant_mismatch: list[InvalidAssetRef]
    cost_center_mismatch: list[InvalidAssetRef]
    plant_id: int | None = None
    cost_center_id: int | None = None
    financial_year_label: str | None = None
    financial_year_start: date | None = None
    financial_year_end: date | None = None
    already_verified_in_fy: list[VerifiedInFinancialYearRef] = Field(default_factory=list)


class CreatePhysicalOrderRequest(BaseModel):
    asset_ids: list[int] = Field(..., min_length=1)
    assigned_to: int | None = None
    remarks: str | None = None
    submit: bool = False
    reset_verification_asset_ids: list[int] = Field(
        default_factory=list,
        description="Assets to clear physical verification when the order is assigned (re-audit in current FY).",
    )


class SubmitPhysicalOrderRequest(BaseModel):
    """Assign an executor from the workflow role and move Draft → Assigned."""

    assigned_to: int = Field(..., ge=1)


class SubmitClosureRequest(BaseModel):
    """Complete execution and hand off to a named closure approver when a workflow is mapped."""

    assignee_user_id: int | None = Field(default=None, ge=1)


class PhysicalOrderItemPublic(BaseModel):
    id: int
    asset_id: int
    asset_code: str
    asset_name: str
    rfid_code: str | None
    verification_status: str
    rejection_reason: str | None
    scan_time: datetime | None
    verified_by_name: str | None
    physically_verified: bool
    last_verification_date: date | None = None


class PhysicalOrderListItem(BaseModel):
    id: int
    order_number: str
    plant_id: int
    plant_name: str
    cost_center_id: int
    cost_center_code: str
    cost_center_description: str
    asset_count: int
    status: str
    closed_at: datetime | None = None
    has_closure_workflow: bool = False
    assigned_to_name: str | None
    created_by_name: str | None
    created_at: datetime
    needs_my_action: bool = False
    my_action_label: str | None = None


class PhysicalOrderListResponse(BaseModel):
    items: list[PhysicalOrderListItem]
    total: int
    page: int
    page_size: int
    tab_counts: dict[str, int] = Field(default_factory=dict)


class PhysicalOrderAuditVerifiedAsset(BaseModel):
    asset_code: str
    asset_name: str | None = None
    rfid_code: str | None = None
    verified_at: datetime | None = None
    verified_by_name: str | None = None


class PhysicalOrderAuditPublic(BaseModel):
    id: int
    action: str
    label: str
    detail: str | None = None
    actor_name: str | None
    old_value: dict | None
    new_value: dict | None
    created_at: datetime
    verified_assets: list[PhysicalOrderAuditVerifiedAsset] = Field(default_factory=list)


class OrderWorkflowStepDefinition(BaseModel):
    step_order: int
    role_name: str
    required_approvals: int


class OrderWorkflowDefinition(BaseModel):
    phase: str
    workflow_name: str
    action_code: str
    steps: list[OrderWorkflowStepDefinition]


class OrderLifecycleApproverSlot(BaseModel):
    slot: int
    status: str
    actor_name: str | None = None
    acted_at: datetime | None = None
    comment: str | None = None


class OrderLifecycleStepPublic(BaseModel):
    key: str
    label: str
    status: str
    role_name: str | None = None
    actor_name: str | None = None
    occurred_at: datetime | None = None
    detail: str | None = None
    approver_slots: list[OrderLifecycleApproverSlot] = Field(default_factory=list)


class PhysicalOrderApprovalNotice(BaseModel):
    """Shown to creation approvers when FY re-verification applies."""

    financial_year_label: str | None = None
    financial_year_start: date | None = None
    financial_year_end: date | None = None
    fy_verified_asset_codes: list[str] = Field(default_factory=list)
    reset_on_approval_asset_codes: list[str] = Field(default_factory=list)
    message: str | None = None


class PhysicalOrderProgressPublic(BaseModel):
    steps: list[OrderLifecycleStepPublic]
    current_step_key: str | None
    creation_workflow: OrderWorkflowDefinition | None = None
    closure_workflow: OrderWorkflowDefinition | None = None


class PhysicalOrderDetail(BaseModel):
    id: int
    order_number: str
    plant_id: int
    plant_name: str
    cost_center_id: int
    cost_center_code: str
    cost_center_description: str
    status: str
    remarks: str | None
    created_by: int | None
    created_by_name: str | None
    assigned_to: int | None
    assigned_to_name: str | None
    assigned_by_name: str | None
    assigned_at: datetime | None
    started_at: datetime | None
    started_by_name: str | None
    completed_at: datetime | None
    closed_at: datetime | None = None
    created_at: datetime
    approval_request_id: int | None
    items: list[PhysicalOrderItemPublic]
    verified_count: int
    physically_verified_count: int
    pending_physical_count: int
    rejected_item_count: int
    total_count: int
    audit: list[PhysicalOrderAuditPublic]
    progress: PhysicalOrderProgressPublic
    approval_notice: PhysicalOrderApprovalNotice | None = None
    can_delete: bool = False
    can_archive: bool = False
    can_unarchive: bool = False


class ExecutorUserPublic(BaseModel):
    id: int
    full_name: str
    email: str | None


class ExecutorListResponse(BaseModel):
    """Users in the Assign-step role of the Physical order workflow."""

    role_id: int
    role_name: str
    items: list[ExecutorUserPublic]


class UpdatePhysicalOrderRequest(BaseModel):
    assigned_to: int | None = None
    remarks: str | None = None
    asset_ids: list[int] | None = None


class ItemIdsRequest(BaseModel):
    item_ids: list[int] = Field(..., min_length=1)


class RejectItemsRequest(BaseModel):
    item_ids: list[int] = Field(..., min_length=1)
    rejection_reason: str = Field(..., min_length=1)


class RejectOrderRequest(BaseModel):
    reason: str = Field(..., min_length=1)


class ScanAssetRequest(BaseModel):
    scan_value: str = Field(..., min_length=1)
    item_id: int | None = None


class ScanAssetResponse(BaseModel):
    item: PhysicalOrderItemPublic
    verified_count: int
    total_count: int
