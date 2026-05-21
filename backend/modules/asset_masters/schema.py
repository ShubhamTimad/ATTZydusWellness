from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _norm_code(value: str) -> str:
    code = value.strip().upper()
    if not code:
        raise ValueError("Code is required")
    return code


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


class PlantChildCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=512)
    plant_id: int

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class PlantChildUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, min_length=1, max_length=512)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _norm_code(value)


class PlantChildPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str
    plant_id: int
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CostCenterChildCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=512)
    cost_center_id: int

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class CostCenterChildPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str
    cost_center_id: int
    cost_center_code: str | None = None
    plant_id: int | None = None
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class FunctionalChildCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=512)
    functional_location_id: int

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return _norm_code(value)


class FunctionalChildPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    description: str
    functional_location_id: int
    functional_location_code: str | None = None
    plant_id: int | None = None
    plant_code: str | None = None
    plant_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
