from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AssetCategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    is_active: bool


class AssetInformationPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    inventory_no: str | None = None
    asset_description: str | None = None
    engineering_description: str | None = None
    qa_description: str | None = None
    is_local_finance_user: bool | None = None
    asset_allocation: str | None = None
    pm_equipment_id: str | None = None


class AssetLocationPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    plant_id: int | None = None
    functional_location: str | None = None
    actual_location: str | None = None
    building: str | None = None
    floor: str | None = None
    room: str | None = None
    zone: str | None = None


class AssetFinancialPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cost_center: str | None = None
    profit_center: str | None = None
    cap_date: date | None = None
    gross_block: Decimal | None = None
    vendor_name: str | None = None
    po_number: str | None = None
    currency: str | None = None


class AssetInventoryPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    inventory_count: int | None = None
    physical_count: int | None = None
    last_verification_date: date | None = None
    verification_status: str | None = None
    verification_remarks: str | None = None


class AssetCreateRequest(BaseModel):
    asset_name: str = Field(min_length=1, max_length=255)
    asset_code: str = Field(min_length=1, max_length=128)
    rfid_code: str | None = Field(default=None, max_length=128)
    serial_no: str | None = Field(default=None, max_length=128)
    asset_category_id: int | None = None
    ownership_type: str | None = Field(default=None, max_length=64)
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None


class AssetUpdateRequest(BaseModel):
    asset_name: str | None = Field(default=None, min_length=1, max_length=255)
    asset_code: str | None = Field(default=None, min_length=1, max_length=128)
    rfid_code: str | None = None
    serial_no: str | None = None
    asset_category_id: int | None = None
    ownership_type: str | None = None
    lifecycle_status: str | None = None
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None


class AssetListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_name: str
    asset_code: str
    category_name: str | None = None
    plant_name: str | None = None
    functional_location: str | None = None
    actual_location: str | None = None
    cost_center: str | None = None
    inventory_count: int | None = None
    physical_count: int | None = None
    last_verification_date: date | None = None
    lifecycle_status: str
    approval_status: str
    source_type: str
    created_at: datetime


class AssetListResponse(BaseModel):
    items: list[AssetListItem]
    total: int
    page: int
    page_size: int


class AssetDetailPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_name: str
    asset_code: str
    rfid_code: str | None
    serial_no: str | None
    asset_category_id: int | None
    category_name: str | None = None
    lifecycle_status: str
    approval_status: str
    ownership_type: str | None
    source_type: str
    import_batch_id: int | None
    created_by: int | None
    approved_by: int | None
    created_at: datetime
    updated_at: datetime
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None
    plant_name: str | None = None


class AssetAuditEventPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    section: str | None
    actor_user_id: int | None
    old_value: dict[str, Any] | None
    new_value: dict[str, Any] | None
    created_at: datetime


class ImportPreviewRow(BaseModel):
    row_number: int
    valid: bool
    errors: list[str] = Field(default_factory=list)
    duplicate_asset_code: bool = False
    data: dict[str, Any] = Field(default_factory=dict)


class ImportPreviewResponse(BaseModel):
    filename: str | None
    total_rows: int
    valid_rows: int
    error_rows: int
    rows: list[ImportPreviewRow]


class ImportConfirmRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1)
    filename: str | None = None
    initiate_approval: bool = True


class ImportConfirmResponse(BaseModel):
    batch_id: int
    created_count: int
    pending_approval: bool
    errors: list[str] = Field(default_factory=list)
