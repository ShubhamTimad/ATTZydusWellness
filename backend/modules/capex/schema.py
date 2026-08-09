from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from modules.platform.tasks.schema import TaskApprovalStepLinePublic


class CapexFormFields(BaseModel):
    asset_name: str = Field(min_length=1, max_length=512)
    equipment_tag_no: str | None = Field(default=None, max_length=128)
    asset_specifications: str | None = None
    party_name: str | None = Field(default=None, max_length=255)
    department: str | None = Field(default=None, max_length=255)
    installation_location: str | None = Field(default=None, max_length=255)
    department_head: str | None = Field(default=None, max_length=255)
    functioning_comment: str | None = None
    installation_date: date | None = None
    auc_code: str | None = Field(default=None, max_length=128)
    useful_life: str | None = Field(default=None, max_length=64)
    requires_engineering: bool = False
    cost_center_id: int | None = Field(
        default=None, ge=1, description="Scopes the approver pool to this cost center."
    )


class CapexFormCreateRequest(CapexFormFields):
    submit: bool = False
    assignee_user_id: int | None = Field(default=None, ge=1)


class CapexFormUpdateRequest(BaseModel):
    asset_name: str | None = Field(default=None, min_length=1, max_length=512)
    equipment_tag_no: str | None = Field(default=None, max_length=128)
    asset_specifications: str | None = None
    party_name: str | None = Field(default=None, max_length=255)
    department: str | None = Field(default=None, max_length=255)
    installation_location: str | None = Field(default=None, max_length=255)
    department_head: str | None = Field(default=None, max_length=255)
    functioning_comment: str | None = None
    installation_date: date | None = None
    auc_code: str | None = Field(default=None, max_length=128)
    useful_life: str | None = Field(default=None, max_length=64)
    requires_engineering: bool | None = None
    cost_center_id: int | None = Field(default=None, ge=1)


class CapexSubmitRequest(BaseModel):
    assignee_user_id: int = Field(ge=1)
    requires_engineering: bool | None = Field(
        default=None,
        description="Applied before workflow selection so 2↔3 step toggle takes effect on resubmit.",
    )


class CapexReassignRequest(BaseModel):
    assignee_user_id: int = Field(ge=1)


class CapexAssigneeOption(BaseModel):
    id: int
    full_name: str
    email: str | None = None


class CapexAssigneeListResponse(BaseModel):
    role_name: str
    items: list[CapexAssigneeOption]


class CapexFormListItem(BaseModel):
    id: int
    form_number: str
    asset_name: str
    department: str | None
    status: str
    requires_engineering: bool
    asset_id: int | None
    created_by_name: str | None
    created_at: datetime
    needs_my_action: bool = False
    my_action_label: str | None = None


class CapexFormListResponse(BaseModel):
    items: list[CapexFormListItem]
    total: int
    page: int
    page_size: int
    tab_counts: dict[str, int] = Field(default_factory=dict)


class CapexWorkflowRunPublic(BaseModel):
    """One approval attempt (initial submit or post-reject resubmit)."""

    attempt: int
    request_id: int
    request_status: str
    is_current: bool = False
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(default_factory=list)


class CapexApprovalPanel(BaseModel):
    """Approval timeline + viewer action context for CapEx form detail."""

    request_id: int
    request_status: str
    workflow_steps: list[TaskApprovalStepLinePublic] = Field(
        default_factory=list,
        description="Latest attempt only; prefer workflow_runs when present.",
    )
    workflow_runs: list[CapexWorkflowRunPublic] = Field(default_factory=list)
    my_pending_task_id: int | None = None
    pending_task_id: int | None = None
    current_assignee_user_id: int | None = None
    current_assignee_name: str | None = None
    current_step_role_name: str | None = None
    current_assignee_level: str | None = None
    current_step_kind: str | None = None
    current_step_order: int | None = None
    is_final_step: bool = False
    needs_next_assignee: bool = False
    next_step_role_name: str | None = None
    next_assignee_role_id: int | None = None
    next_assignee_level: str | None = None
    next_step_kind: str | None = None
    current_assignee_role_id: int | None = None


class CapexFormDetail(BaseModel):
    id: int
    form_number: str
    status: str
    asset_name: str
    equipment_tag_no: str | None
    asset_specifications: str | None
    party_name: str | None
    department: str | None
    installation_location: str | None
    department_head: str | None
    functioning_comment: str | None
    installation_date: date | None
    auc_code: str | None
    useful_life: str | None
    requires_engineering: bool
    cost_center_id: int | None = None
    cost_center_code: str | None = None
    cost_center_name: str | None = None
    approval_request_id: int | None
    asset_id: int | None
    asset_code: str | None = None
    rejection_comment: str | None
    created_by: int | None
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime
    approval_panel: CapexApprovalPanel | None = None
    can_delete: bool = False
    can_archive: bool = False


class CapexAuditChange(BaseModel):
    field: str
    from_value: str | None = None
    to_value: str | None = None


class CapexAuditEventPublic(BaseModel):
    id: int
    action: str
    label: str
    detail: str | None = None
    actor_name: str | None = None
    changes: list[CapexAuditChange] = Field(default_factory=list)
    created_at: datetime
