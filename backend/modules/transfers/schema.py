from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TransferAssigneeOption(BaseModel):
    id: int
    full_name: str
    email: str | None = None


class TransferAssigneeListResponse(BaseModel):
    role_name: str
    items: list[TransferAssigneeOption]


class TransferDestinationCostCenter(BaseModel):
    """Plant cost centers for transfer destination (not scoped to the viewer's CCs)."""

    id: int
    code: str
    name: str
    description: str
    plant_id: int
    is_active: bool


class CreateTransferOrderRequest(BaseModel):
    asset_ids: list[int] = Field(min_length=1)
    to_cost_center_id: int
    to_asset_custodian_id: int
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    remarks: str | None = None
    assigned_to: int | None = None
    submit: bool = False


class UpdateTransferOrderRequest(BaseModel):
    to_cost_center_id: int | None = None
    to_asset_custodian_id: int | None = None
    to_functional_location: str | None = None
    to_actual_location: str | None = None
    remarks: str | None = None
    asset_ids: list[int] | None = None


class SubmitTransferOrderRequest(BaseModel):
    assigned_to: int
    remarks: str | None = None


class CfApproveTransferRequest(BaseModel):
    """Approve and assign the order to the destination asset custodian for receive."""

    assigned_to: int | None = None  # ignored; assignment goes to to_asset_custodian_id
    to_cost_center_id: int | None = None
    remarks: str | None = None


class CfRejectTransferRequest(BaseModel):
    reason: str = Field(min_length=1)


class Cc2AssignTransferRequest(BaseModel):
    """Destination custodian receives assets and sets locations, then assigns CF to confirm."""

    assigned_to: int
    to_functional_location: str = Field(min_length=1)
    to_actual_location: str = Field(min_length=1)
    remarks: str | None = None


class TransferOrderItemPublic(BaseModel):
    id: int
    asset_id: int
    asset_code: str
    asset_name: str
    from_cost_center_code: str | None = None
    from_functional_location: str | None = None
    from_actual_location: str | None = None


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
    created_by_name: str | None = None
    created_at: datetime


class TransferOrderListResponse(BaseModel):
    items: list[TransferOrderListItem]
    total: int
    page: int
    page_size: int


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
    status: str
    remarks: str | None = None
    rejection_reason: str | None = None
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
    can_submit: bool = False
    can_cf_decide: bool = False
    can_cf_reject: bool = False
    can_cc2_assign: bool = False
    can_cf_confirm: bool = False
    can_cf_close: bool = False
    can_edit: bool = False
