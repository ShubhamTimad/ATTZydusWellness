from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class AssetCategory(Base):
    __tablename__ = "asset_categories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AssetImportBatch(Base):
    """Bulk import run — supports future async processing and batch approval."""

    __tablename__ = "asset_import_batches"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    valid_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_rows: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft")
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assets = relationship("AssetMaster", back_populates="import_batch")


class AssetMaster(Base):
    __tablename__ = "asset_master"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    asset_code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    rfid_code: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    serial_no: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    asset_category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("asset_categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    asset_class: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    asset_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lifecycle_status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft", index=True)
    approval_status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="not_required", index=True)
    ownership_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="manual")
    import_batch_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("asset_import_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    category = relationship("AssetCategory")
    import_batch = relationship("AssetImportBatch", back_populates="assets")
    information = relationship(
        "AssetInformation", back_populates="asset", uselist=False, cascade="all, delete-orphan"
    )
    location = relationship(
        "AssetLocationInformation", back_populates="asset", uselist=False, cascade="all, delete-orphan"
    )
    financial = relationship(
        "AssetFinancialInformation", back_populates="asset", uselist=False, cascade="all, delete-orphan"
    )
    inventory = relationship(
        "AssetInventoryInformation", back_populates="asset", uselist=False, cascade="all, delete-orphan"
    )


class AssetInformation(Base):
    __tablename__ = "asset_information"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    inventory_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    asset_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    engineering_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    qa_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_local_finance_user: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    asset_allocation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pm_equipment_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    asset = relationship("AssetMaster", back_populates="information")


class AssetLocationInformation(Base):
    __tablename__ = "asset_location_information"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    plant_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("org_units.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sub_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    functional_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    actual_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    building: Mapped[str | None] = mapped_column(String(128), nullable=True)
    floor: Mapped[str | None] = mapped_column(String(64), nullable=True)
    room: Mapped[str | None] = mapped_column(String(64), nullable=True)
    zone: Mapped[str | None] = mapped_column(String(64), nullable=True)

    asset = relationship("AssetMaster", back_populates="location")
    plant = relationship("OrgUnit")


class AssetFinancialInformation(Base):
    __tablename__ = "asset_financial_information"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    cost_center: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    laboratory: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profit_center: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cap_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gross_block: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    party_details: Mapped[str | None] = mapped_column(String(512), nullable=True)
    invoice_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    voucher_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    voucher_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    grn_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    grn_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    put_to_use_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    depreciation_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    life_span: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    po_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)

    asset = relationship("AssetMaster", back_populates="financial")


class AssetInventoryInformation(Base):
    __tablename__ = "asset_inventory_information"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    inventory_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    physical_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_verification_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verification_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    asset = relationship("AssetMaster", back_populates="inventory")


class AssetAuditEvent(Base):
    """Field-level asset history (complements approval timeline + RBAC audit)."""

    __tablename__ = "asset_audit_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    section: Mapped[str | None] = mapped_column(String(64), nullable=True)
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
