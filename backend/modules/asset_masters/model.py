from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class CostCenterMaster(Base):
    __tablename__ = "cost_center_masters"
    __table_args__ = (UniqueConstraint("plant_id", "code", name="uq_cost_center_masters_plant_code"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("org_units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plant = relationship("OrgUnit")
    profit_centers = relationship("ProfitCenterMaster", back_populates="cost_center")


class ProfitCenterMaster(Base):
    __tablename__ = "profit_center_masters"
    __table_args__ = (
        UniqueConstraint("cost_center_id", "code", name="uq_profit_center_masters_cc_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    cost_center_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cost_center_masters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    cost_center = relationship("CostCenterMaster", back_populates="profit_centers")


class FunctionalLocationMaster(Base):
    __tablename__ = "functional_location_masters"
    __table_args__ = (
        UniqueConstraint("plant_id", "code", name="uq_functional_location_masters_plant_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("org_units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    plant = relationship("OrgUnit")
    actual_locations = relationship("ActualLocationMaster", back_populates="functional_location")


class ActualLocationMaster(Base):
    __tablename__ = "actual_location_masters"
    __table_args__ = (
        UniqueConstraint("functional_location_id", "code", name="uq_actual_location_masters_fl_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    functional_location_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("functional_location_masters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    functional_location = relationship("FunctionalLocationMaster", back_populates="actual_locations")


class TagColorMaster(Base):
    __tablename__ = "tag_color_masters"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color_hex: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
