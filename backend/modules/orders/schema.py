from __future__ import annotations

from datetime import datetime

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


class ValidateAssetsResponse(BaseModel):
    eligible_asset_ids: list[int]
    active_order_conflicts: list[ActiveOrderConflict]
    missing_rfid: list[InvalidAssetRef]
    plant_mismatch: list[InvalidAssetRef]
    cost_center_mismatch: list[InvalidAssetRef]


class CreatePhysicalOrderRequest(BaseModel):
    asset_ids: list[int] = Field(..., min_length=1)
    assigned_to: int
    remarks: str | None = None
    submit: bool = True


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
    assigned_to_name: str | None
    created_by_name: str | None
    created_at: datetime


class PhysicalOrderListResponse(BaseModel):
    items: list[PhysicalOrderListItem]
    total: int
    page: int
    page_size: int


class PhysicalOrderAuditPublic(BaseModel):
    id: int
    action: str
    actor_name: str | None
    old_value: dict | None
    new_value: dict | None
    created_at: datetime


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
    created_at: datetime
    approval_request_id: int | None
    items: list[PhysicalOrderItemPublic]
    verified_count: int
    total_count: int
    audit: list[PhysicalOrderAuditPublic]


class ExecutorUserPublic(BaseModel):
    id: int
    full_name: str
    email: str | None


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


class ScanAssetResponse(BaseModel):
    item: PhysicalOrderItemPublic
    verified_count: int
    total_count: int
