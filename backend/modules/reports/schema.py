from __future__ import annotations

from pydantic import BaseModel


class ReportFilterOptionPublic(BaseModel):
    value: str
    label: str


class ReportFilterPublic(BaseModel):
    key: str
    label: str
    kind: str
    options: list[ReportFilterOptionPublic]


class ReportDefinitionPublic(BaseModel):
    key: str
    title: str
    description: str
    filters: list[ReportFilterPublic]


class PlantOptionPublic(BaseModel):
    id: int
    name: str
    code: str


class ReportCatalogPublic(BaseModel):
    reports: list[ReportDefinitionPublic]
    plants: list[PlantOptionPublic]
