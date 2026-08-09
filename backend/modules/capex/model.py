from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class CapitalizationForm(Base):
    __tablename__ = "capitalization_forms"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    form_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft", index=True)

    asset_name: Mapped[str] = mapped_column(String(512), nullable=False)
    equipment_tag_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    asset_specifications: Mapped[str | None] = mapped_column(Text, nullable=True)
    party_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    installation_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department_head: Mapped[str | None] = mapped_column(String(255), nullable=True)
    functioning_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    installation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    auc_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    useful_life: Mapped[str | None] = mapped_column(String(64), nullable=True)
    requires_engineering: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    cost_center_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("cost_center_masters.id", ondelete="SET NULL"), nullable=True, index=True
    )

    approval_request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("approval_requests.id", ondelete="SET NULL"), nullable=True
    )
    asset_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("asset_master.id", ondelete="SET NULL"), nullable=True, index=True
    )
    rejection_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    creator = relationship("User", foreign_keys=[created_by])
    asset = relationship("AssetMaster", foreign_keys=[asset_id])
    cost_center = relationship("CostCenterMaster", foreign_keys=[cost_center_id])
    audit_events = relationship(
        "CapitalizationFormAudit",
        back_populates="form",
        cascade="all, delete-orphan",
        order_by="CapitalizationFormAudit.id.desc()",
    )


class CapitalizationFormAudit(Base):
    __tablename__ = "capitalization_form_audit"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    form_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("capitalization_forms.id", ondelete="CASCADE"),
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

    form = relationship("CapitalizationForm", back_populates="audit_events")
    actor = relationship("User", foreign_keys=[actor_user_id])
