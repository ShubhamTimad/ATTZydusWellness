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
    description: str | None = None
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
    sub_location: str | None = None
    functional_location: str | None = None
    actual_location: str | None = None
    building: str | None = None
    floor: str | None = None
    room: str | None = None
    zone: str | None = None


class AssetFinancialPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    cost_center: str | None = None
    laboratory: str | None = None
    profit_center: str | None = None
    cap_date: date | None = None
    gross_block: Decimal | None = None
    party_details: str | None = None
    invoice_no: str | None = None
    invoice_date: date | None = None
    voucher_no: str | None = None
    voucher_date: date | None = None
    grn_no: str | None = None
    grn_date: date | None = None
    put_to_use_date: date | None = None
    depreciation_rate: Decimal | None = None
    life_span: str | None = None
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
    asset_class: str | None = Field(default=None, max_length=128)
    asset_type: str | None = Field(default=None, max_length=128)
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
    asset_class: str | None = Field(default=None, max_length=128)
    asset_type: str | None = Field(default=None, max_length=128)
    asset_category_id: int | None = None
    ownership_type: str | None = None
    lifecycle_status: str | None = None
    information: AssetInformationPayload | None = None
    location: AssetLocationPayload | None = None
    financial: AssetFinancialPayload | None = None
    inventory: AssetInventoryPayload | None = None

class AssetRfidUpdateRequest(BaseModel):
    rfid_code: str

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
    asset_class: str | None = None
    asset_type: str | None = None
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


class SubmitForApprovalResponse(BaseModel):
    submitted_count: int
    activated_count: int
    errors: list[str] = Field(default_factory=list)


class ImportConfirmResponse(BaseModel):
    batch_id: int
    created_count: int
    pending_approval: bool
    errors: list[str] = Field(default_factory=list)
