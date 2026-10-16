from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class AssetDisposalOrder(Base):
    __tablename__ = "asset_disposal_orders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    plant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("org_units.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    from_cost_center_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cost_center_masters.id", ondelete="SET NULL"), nullable=True
    )
    # Scrapyard destination (cost_center_masters.is_scrapyard); set at create/edit, used at receive.
    to_cost_center_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cost_center_masters.id", ondelete="SET NULL"), nullable=True, index=True
    )
    requires_engineering: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    approval_request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("approval_requests.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_to: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Cost Center User chosen at enter-receive; kept after receive so CF reject can return here.
    receiver_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="draft", index=True
    )
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plant = relationship("OrgUnit", foreign_keys=[plant_id])
    from_cost_center = relationship("CostCenterMaster", foreign_keys=[from_cost_center_id])
    to_cost_center = relationship("CostCenterMaster", foreign_keys=[to_cost_center_id])
    creator = relationship("User", foreign_keys=[created_by])
    assignee = relationship("User", foreign_keys=[assigned_to])
    receiver = relationship("User", foreign_keys=[receiver_user_id])
    items = relationship(
        "AssetDisposalOrderItem", back_populates="order", cascade="all, delete-orphan"
    )


class AssetDisposalOrderItem(Base):
    __tablename__ = "asset_disposal_order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "asset_id", name="uq_asset_disposal_order_items_order_asset"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("asset_disposal_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    asset_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_cost_center_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    from_functional_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    from_actual_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Scrapyard Actual Location 1 / 2 per asset — the receiver may fill these in over
    # several visits, so they are set before the order moves on.
    to_functional_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    to_actual_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Scrapyard custodian for this asset; the order's receiver_user_id mirrors the first one.
    to_asset_custodian_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    order = relationship("AssetDisposalOrder", back_populates="items")
    asset = relationship("AssetMaster")
    to_asset_custodian = relationship("User", foreign_keys=[to_asset_custodian_id])


class AssetDisposalOrderAudit(Base):
    __tablename__ = "asset_disposal_order_audit"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("asset_disposal_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order = relationship("AssetDisposalOrder")
    actor = relationship("User", foreign_keys=[actor_user_id])
