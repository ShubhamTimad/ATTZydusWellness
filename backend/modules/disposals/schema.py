from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from modules.platform.tasks.schema import TaskApprovalStepLinePublic


class CreateDisposalOrderRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)
    remarks: str | None = None
    requires_engineering: bool = False
    # Scrapyard destination (must be is_scrapyard); required when submit=true.
    to_cost_center_id: int | None = Field(default=None, ge=1)
    assignee_user_id: int | None = Field(default=None, ge=1)
    submit: bool = False


class UpdateDisposalOrderRequest(BaseModel):
    remarks: str | None = None
    requires_engineering: bool | None = None
    asset_ids: list[int] | None = None
    to_cost_center_id: int | None = Field(default=None, ge=1)


class SubmitDisposalOrderRequest(BaseModel):
    assignee_user_id: int = Field(ge=1)
    requires_engineering: bool | None = Field(
        default=None,
        description="Applied before workflow selection so the engineering toggle affects resubmits.",
    )


class ReassignDisposalRequest(BaseModel):
    assignee_user_id: int = Field(ge=1)


class ReceiveDisposalRequest(BaseModel):
    """Receiver: set scrapyard Actual Location 1/2, then pick the CF who will approve and close.

    Scrapyard cost center is fixed on the order at submit; ``cost_center_id`` is ignored if sent.
    """

    assigned_to: int = Field(ge=1, description="Central Finance user for final approve + close")
    functional_location: str = Field(min_length=1, max_length=255)
    actual_location: str = Field(min_length=1, max_length=255)
    cost_center_id: int | None = Field(
        default=None,
        ge=1,
        description="Ignored — order scrapyard cost center is used.",
    )
    remarks: str | None = None


class CloseDisposalRequest(BaseModel):
    remarks: str | None = None


class DisposalAssigneeOption(BaseModel):
    id: int
    full_name: str
    email: str | None = None


class DisposalAssigneeListResponse(BaseModel):
    role_name: str
    items: list[DisposalAssigneeOption]


class DisposalOrderItemPublic(BaseModel):
    id: int
    asset_id: int
    asset_code: str
    asset_name: str
    from_cost_center_code: str | None = None
    from_functional_location: str | None = None
    from_actual_location: str | None = None


class DisposalOrderAuditPublic(BaseModel):
    id: int
    action: str
    actor_name: str | None = None
    old_value: dict | None = None
    new_value: dict | None = None
    created_at: datetime


class DisposalOrderListItem(BaseModel):
    id: int
    order_number: str
    plant_name: str
    from_cost_center_code: str | None = None
    asset_count: int
    status: str
    requires_engineering: bool
    assigned_to_name: str | None = None
    created_by_name: str | None = None
    created_at: datetime
    needs_my_action: bool = False
    my_action_label: str | None = None


class DisposalOrderListResponse(BaseModel):
    items: list[DisposalOrderListItem]
    total: int
    page: int
    page_size: int
    tab_counts: dict[str, int] = Field(default_factory=dict)


class DisposalWorkflowRunPublic(BaseModel):
    """One approval attempt (initial submit or post-reject resubmit)."""

    attempt: int
    request_id: int
    request_status: str
    is_current: bool = False
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)


class DisposalApprovalPanel(BaseModel):
    """Approval timeline + viewer action context for disposal order detail."""

    request_id: int
    request_status: str
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(
        default_factory=list,
        description="Latest attempt only; prefer workflow_runs when present.",
    )
    workflow_runs: list[DisposalWorkflowRunPublic] = Field(default_factory=list)
    my_pending_task_id: int | None = None
    pending_task_id: int | None = None
    current_assignee_user_id: int | None = None
    current_assignee_name: str | None = None
    current_step_role_name: str | None = None
    current_assignee_level: str | None = None
    current_step_kind: str = "approve"
    is_final_step: bool = False
    # True when the actor must name the next step's user (or legacy final receiver).
    needs_next_assignee: bool = False
    next_step_role_name: str | None = None
    next_assignee_role_id: int | None = None
    next_assignee_level: str | None = None
    next_step_kind: str | None = None


class DisposalOrderDetail(BaseModel):
    id: int
    order_number: str
    plant_id: int
    plant_name: str
    from_cost_center_id: int | None = None
    from_cost_center_code: str | None = None
    from_cost_center_description: str | None = None
    to_cost_center_id: int | None = None
    to_cost_center_code: str | None = None
    to_cost_center_description: str | None = None
    # Scrapyard Actual Location 1 / 2 chosen at receive (null until received).
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    requires_engineering: bool
    status: str
    remarks: str | None = None
    rejection_comment: str | None = None
    approval_request_id: int | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    assigned_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    items: list[DisposalOrderItemPublic]
    audit: list[DisposalOrderAuditPublic] = Field(default_factory=list)
    approval_panel: DisposalApprovalPanel | None = None
    can_submit: bool = False
    can_edit: bool = False
    can_resume: bool = False
    can_receive: bool = False
    can_close: bool = False
    can_delete: bool = False
    can_archive: bool = False
    can_unarchive: bool = False
