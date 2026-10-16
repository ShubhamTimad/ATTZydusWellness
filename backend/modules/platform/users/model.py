from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, LargeBinary, String, false, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from modules.rbac_association import user_cost_center, user_department, user_org_unit, user_role


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True, index=True)
    # IdP subject (OIDC sub / Entra oid) when the user signs in via SSO.
    external_subject: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    is_superuser: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=false(),
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=true(),
    )
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="0",
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    asset_list_columns: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    photo_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    photo_content_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    roles = relationship(
        "Role",
        secondary=user_role,
        back_populates="users",
    )
    sessions = relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    org_units = relationship(
        "OrgUnit",
        secondary=user_org_unit,
        lazy="selectin",
        overlaps="departments",
    )
    departments = relationship(
        "OrgUnit",
        secondary=user_department,
        lazy="selectin",
        overlaps="org_units",
    )
    cost_centers = relationship(
        "CostCenterMaster",
        secondary=user_cost_center,
        lazy="selectin",
    )
    mfa_record = relationship(
        "UserMfa",
        back_populates="user",
        uselist=False,
    )
