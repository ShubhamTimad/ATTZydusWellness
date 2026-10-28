from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, field_validator, model_validator

from core.phone import normalize_phone


class RoleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class OrgUnitSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    code: str | None = None


class CostCenterSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str


def _dedupe_positive_ids(value: object) -> object:
    if not isinstance(value, list):
        return value
    seen: set[int] = set()
    out: list[int] = []
    for raw in value:
        n = int(raw)
        if n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=3, max_length=64)
    phone: str = Field(min_length=10, max_length=32)
    email: EmailStr
    # ``role_id`` is accepted so older clients keep working; assignment uses ``role_ids``.
    role_id: int | None = Field(default=None, ge=1)
    role_ids: list[int] = Field(default_factory=list)
    org_unit_ids: list[int] = Field(min_length=1)
    department_ids: list[int] = Field(default_factory=list)
    cost_center_ids: list[int] = Field(default_factory=list)
    is_active: bool = True

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("role_ids", "org_unit_ids", "department_ids", "cost_center_ids", mode="before")
    @classmethod
    def _dedupe_ids(cls, value: object) -> object:
        return _dedupe_positive_ids(value)

    @model_validator(mode="after")
    def _require_roles(self) -> "UserCreate":
        ids = list(self.role_ids)
        if self.role_id is not None and self.role_id not in ids:
            ids.append(self.role_id)
        if not ids:
            raise ValueError("At least one role is required")
        self.role_ids = ids
        return self


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=3, max_length=64)
    phone: str | None = Field(default=None, min_length=10, max_length=32)
    email: EmailStr | None = None
    role_id: int | None = Field(default=None, ge=1)
    role_ids: list[int] | None = None
    org_unit_ids: list[int] | None = None
    department_ids: list[int] | None = None
    cost_center_ids: list[int] | None = None
    is_active: bool | None = None

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_phone(value)

    @field_validator("role_ids", "org_unit_ids", "department_ids", "cost_center_ids", mode="before")
    @classmethod
    def _dedupe_ids(cls, value: object) -> object:
        if value is None:
            return value
        return _dedupe_positive_ids(value)


class UserListPage(BaseModel):
    items: list["UserPublic"]
    total: int
    page: int
    page_size: int


class UserFilterOptions(BaseModel):
    plants: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    cost_centers: list[str] = Field(default_factory=list)


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    username: str
    phone: str | None
    email: str | None
    is_active: bool
    is_superuser: bool
    locked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    mfa_record: object | None = Field(default=None, exclude=True)
    photo_content_type: str | None = Field(default=None, exclude=True)
    roles: list[RoleSummary] = Field(default_factory=list)
    org_units: list[OrgUnitSummary] = Field(default_factory=list)
    departments: list[OrgUnitSummary] = Field(default_factory=list)
    cost_centers: list[CostCenterSummary] = Field(default_factory=list)

    @computed_field  # type: ignore[misc]
    @property
    def is_locked(self) -> bool:
        return self.locked_at is not None

    @computed_field  # type: ignore[misc]
    @property
    def has_photo(self) -> bool:
        return self.photo_content_type is not None

    @computed_field  # type: ignore[misc]
    @property
    def mfa_setup_completed(self) -> bool:
        m = self.mfa_record
        try:
            return bool(getattr(m, "setup_completed"))
        except Exception:
            return False

    @computed_field  # type: ignore[misc]
    @property
    def role(self) -> RoleSummary | None:
        if not self.roles:
            return None
        return self.roles[0]

    @computed_field  # type: ignore[misc]
    @property
    def org_unit(self) -> OrgUnitSummary | None:
        if not self.org_units:
            return None
        return self.org_units[0]

    @computed_field  # type: ignore[misc]
    @property
    def department(self) -> OrgUnitSummary | None:
        if not self.departments:
            return None
        return self.departments[0]

    @computed_field  # type: ignore[misc]
    @property
    def cost_center(self) -> CostCenterSummary | None:
        if not self.cost_centers:
            return None
        return self.cost_centers[0]


class UserAssigneeOption(BaseModel):
    id: int
    full_name: str
    email: str | None = None


class UserAssigneeListResponse(BaseModel):
    role_name: str
    items: list[UserAssigneeOption] = Field(default_factory=list)


class UserSubmitForApprovalRequest(BaseModel):
    # Required when a users.create workflow exists; ignored when auto-activating.
    assignee_user_id: int | None = Field(default=None, ge=1)


class UserSubmitForApprovalResponse(BaseModel):
    status: str  # submitted | activated
    user_id: int


class UserDetailPublic(UserPublic):
    """User detail with creation-approval flags for the Submit button."""

    approval_status: str = "approved"  # draft | pending | rejected | approved
    can_submit_for_approval: bool = False


UserListPage.model_rebuild()
