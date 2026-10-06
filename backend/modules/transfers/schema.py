from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from modules.platform.tasks.schema import TaskApprovalStepLinePublic


class TransferAssigneeOption(BaseModel):
    id: int
    full_name: str
    email: str | None = None


class TransferAssigneeListResponse(BaseModel):
    role_name: str
    items: list[TransferAssigneeOption]


class TransferDestinationCostCenter(BaseModel):
    """Plant cost centers for transfer destination (not viewer-scoped; scrapyards excluded)."""

    id: int
    code: str
    name: str
    description: str
    plant_id: int
    is_active: bool


class TransferItemCustodian(BaseModel):
    asset_id: int
    to_asset_custodian_id: int


class TransferItemReceiveLocation(BaseModel):
    asset_id: int
    to_functional_location: str = Field(min_length=1)
    to_actual_location: str = Field(min_length=1)


class TransferItemPartialLocation(BaseModel):
    """One asset's receive locations, either of which may be filled in later."""

    asset_id: int
    to_functional_location: str | None = None
    to_actual_location: str | None = None


class SaveReceiveLocationsRequest(BaseModel):
    item_locations: list[TransferItemPartialLocation] = Field(min_length=1)


class ValidateTransferAssetsRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)


class TransferInProgressAsset(BaseModel):
    asset_id: int
    asset_code: str
    asset_name: str
    reason: str = ""


class ValidateTransferAssetsResponse(BaseModel):
    in_progress: list[TransferInProgressAsset] = []


class CreateTransferOrderRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)
    to_cost_center_id: int
    to_asset_custodian_id: int | None = None
    item_custodians: list[TransferItemCustodian] | None = None
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    remarks: str | None = None
    assigned_to: int | None = None
    submit: bool = False

    @model_validator(mode="after")
    def dest_custodian_present(self) -> CreateTransferOrderRequest:
        if self.to_asset_custodian_id is not None or self.item_custodians:
            return self
        raise ValueError("Select the destination asset custodian.")


class UpdateTransferOrderRequest(BaseModel):
    to_cost_center_id: int | None = None
    to_asset_custodian_id: int | None = None
    item_custodians: list[TransferItemCustodian] | None = None
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    remarks: str | None = None
    asset_ids: list[int] | None = None


class SubmitTransferOrderRequest(BaseModel):
    """``assigned_to`` is the first workflow-step approver (role from Workflow Assignment)."""

    assigned_to: int = Field(ge=1)
    remarks: str | None = None


class CfApproveTransferRequest(BaseModel):
    """Deprecated: approvals go through the approval engine / My Tasks."""

    assigned_to: int | None = None
    to_cost_center_id: int | None = None
    remarks: str | None = None


class CfRejectTransferRequest(BaseModel):
    reason: str = Field(min_length=1)


class Cc2AssignTransferRequest(BaseModel):
    """Destination custodian receives assets and sets locations, then assigns CF to confirm."""

    assigned_to: int
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    item_locations: list[TransferItemReceiveLocation] | None = None
    remarks: str | None = None

    @model_validator(mode="after")
    def receive_locations_present(self) -> Cc2AssignTransferRequest:
        if self.item_locations:
            return self
        if (self.to_functional_location or "").strip() and (self.to_actual_location or "").strip():
            return self
        raise ValueError("Actual Location 1 and Actual Location 2 are required when receiving assets.")


class TransferOrderItemPublic(BaseModel):
    id: int
    asset_id: int
    asset_code: str
    asset_name: str
    from_cost_center_code: str | None = None
    from_functional_location: str | None = None
    from_actual_location: str | None = None
    from_functional_location_name: str | None = None
    from_actual_location_name: str | None = None
    to_asset_custodian_id: int | None = None
    to_asset_custodian_name: str | None = None
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    to_functional_location_name: str | None = None
    to_actual_location_name: str | None = None


class TransferOrderAuditPublic(BaseModel):
    id: int
    action: str
    actor_name: str | None = None
    old_value: dict | None = None
    new_value: dict | None = None
    created_at: datetime


class TransferOrderListItem(BaseModel):
    id: int
    order_number: str
    plant_name: str
    from_cost_center_code: str | None = None
    to_cost_center_code: str
    asset_count: int
    status: str
    assigned_to_name: str | None = None
    pending_role_name: str | None = None
    created_by_name: str | None = None
    created_at: datetime
    can_delete: bool = False
    can_archive: bool = False
    can_unarchive: bool = False
    needs_my_action: bool = False
    my_action_label: str | None = None


class TransferOrderListResponse(BaseModel):
    items: list[TransferOrderListItem]
    total: int
    page: int
    page_size: int
    tab_counts: dict[str, int] = Field(default_factory=dict)


class TransferListFilterPlant(BaseModel):
    id: int
    code: str | None = None
    name: str


class TransferListFilterCostCenter(BaseModel):
    id: int
    code: str
    name: str | None = None
    plant_id: int | None = None


class TransferListFilterOptionsResponse(BaseModel):
    plants: list[TransferListFilterPlant] = Field(default_factory=list)
    from_cost_centers: list[TransferListFilterCostCenter] = Field(default_factory=list)
    to_cost_centers: list[TransferListFilterCostCenter] = Field(default_factory=list)
    statuses: list[str] = Field(default_factory=list)


class TransferWorkflowRunPublic(BaseModel):
    attempt: int
    request_id: int
    request_status: str
    is_current: bool = False
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)


class TransferApprovalPanel(BaseModel):
    request_id: int
    request_status: str
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)
    workflow_runs: list[TransferWorkflowRunPublic] = Field(default_factory=list)
    my_pending_task_id: int | None = None
    pending_task_id: int | None = None
    current_assignee_user_id: int | None = None
    current_assignee_name: str | None = None
    current_step_role_name: str | None = None
    current_assignee_level: str | None = None
    current_step_kind: str = "approve"
    is_final_step: bool = False
    # Intermediate steps need a named next assignee; final close step does not.
    needs_next_assignee: bool = False
    next_step_role_name: str | None = None
    # Stable workflow key for the next-step assignee pool (prefer over next_assignee_level).
    next_assignee_role_id: int | None = None
    # Optional legacy slug when the role name matches ASSIGNEE_LEVEL_ROLES; may be null.
    next_assignee_level: str | None = None
    next_step_kind: str | None = None


class TransferOrderDetail(BaseModel):
    id: int
    order_number: str
    plant_id: int
    plant_name: str
    from_cost_center_id: int | None = None
    from_cost_center_code: str | None = None
    from_cost_center_description: str | None = None
    to_cost_center_id: int
    to_cost_center_code: str
    to_cost_center_description: str | None = None
    to_asset_custodian_id: int | None = None
    to_asset_custodian_name: str | None = None
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    to_functional_location_name: str | None = None
    to_actual_location_name: str | None = None
    status: str
    remarks: str | None = None
    rejection_reason: str | None = None
    approval_request_id: int | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    assigned_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    items: list[TransferOrderItemPublic]
    audit: list[TransferOrderAuditPublic] = []
    approval_panel: TransferApprovalPanel | None = None
    can_submit: bool = False
    can_cf_decide: bool = False  # always False when engine-backed; kept for API compat
    can_cf_reject: bool = False
    can_cc2_assign: bool = False
    can_cf_confirm: bool = False
    can_cf_close: bool = False
    can_edit: bool = False
    can_resume: bool = False
    can_delete: bool = False
    can_archive: bool = False
    can_unarchive: bool = False
    # After CF reject returns to receiver: restart full approve flow on same order id.
    can_restart_transfer: bool = False
