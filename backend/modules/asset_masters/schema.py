from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _norm_code(value: str) -> str:
    code = value.strip().upper()
    if not code:
        raise ValueError("Code is required")
    return code


class MasterSetActiveRequest(BaseModel):
    is_active: bool


class MasterCodeDescriptionUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, min_length=1, max_length=512)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class CategoryCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class CategoryUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class CategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None
    is_active: bool
    created_at: datetime | None = None


class TagColorCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    color_hex: str | None = Field(default=None, max_length=16)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class TagColorUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    color_hex: str | None = Field(default=None, max_length=16)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class TagColorPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    color_hex: str | None
    is_active: bool
    created_at: datetime | None = None


class AssetCustodianCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class AssetCustodianUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class AssetCustodianPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    is_active: bool
    created_at: datetime | None = None


class AssetConditionCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class AssetConditionUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class AssetConditionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    is_active: bool
    created_at: datetime | None = None


class AssetClassCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class AssetClassUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class AssetClassPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    is_active: bool
    created_at: datetime | None = None


class CostCenterCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    plant_id: int
    is_scrapyard: bool = False

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class CostCenterUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    is_active: bool | None = None
    is_scrapyard: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class CostCenterPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str
    plant_id: int
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    is_scrapyard: bool = False
    created_at: datetime
    updated_at: datetime


class FunctionalLocationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    plant_id: int
    is_scrapyard: bool = False

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class FunctionalLocationUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    is_active: bool | None = None
    is_scrapyard: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class FunctionalLocationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str
    plant_id: int
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    is_scrapyard: bool = False
    created_at: datetime
    updated_at: datetime


class ProfitCenterCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    cost_center_id: int

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class ProfitCenterUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class ProfitCenterPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str
    cost_center_id: int
    cost_center_code: str | None = None
    plant_id: int | None = None
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ActualLocationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    functional_location_id: int

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class ActualLocationUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=512)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class ActualLocationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str
    functional_location_id: int
    functional_location_code: str | None = None
    plant_id: int | None = None
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CostCenterCustodianUserPublic(BaseModel):
    id: int
    full_name: str
    email: str | None = None
    username: str | None = None


class CostCenterCustodiansPublic(BaseModel):
    cost_center_id: int
    cost_center_code: str
    cost_center_name: str
    plant_id: int
    items: list[CostCenterCustodianUserPublic]


class CostCenterCustodiansReplaceRequest(BaseModel):
    user_ids: list[int] = Field(default_factory=list)
