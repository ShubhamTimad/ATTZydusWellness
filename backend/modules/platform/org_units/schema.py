from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrgUnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=32)
    parent_id: int | None = None

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        code = value.strip().upper()
        if not code:
            raise ValueError("Code is required")
        return code


class OrgUnitUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=64)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        code = value.strip().upper()
        if not code:
            raise ValueError("Code is required")
        return code


class OrgUnitListPage(BaseModel):
    items: list["OrgUnitPublic"]
    total: int
    page: int
    page_size: int


class OrgUnitPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    type: str
    parent_id: int | None
    created_at: datetime
    updated_at: datetime


OrgUnitListPage.model_rebuild()
