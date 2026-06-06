from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from db.session import get_db
from modules.reports.definitions import REPORT_DEFINITIONS, report_by_key
from modules.reports.export import build_pdf, build_xlsx, content_type_for_format, report_filename
from modules.reports.schema import (
    PlantOptionPublic,
    ReportCatalogPublic,
    ReportDefinitionPublic,
    ReportFilterOptionPublic,
    ReportFilterPublic,
)
from modules.reports.service import FY_STATUS_OPTIONS, ORDER_STATUS_OPTIONS, ReportService


router = APIRouter(prefix="/reports", tags=["reports"])


def _filter_options(kind: str) -> list[ReportFilterOptionPublic]:
    if kind == "plant":
        return []
    if kind == "order_status":
        return [
            ReportFilterOptionPublic(value="all", label="All statuses"),
            *[
                ReportFilterOptionPublic(value=s, label=s.replace("_", " ").title())
                for s in ORDER_STATUS_OPTIONS
            ],
        ]
    if kind == "fy_status":
        return [
            ReportFilterOptionPublic(value=s, label=s.replace("_", " ").title())
            for s in FY_STATUS_OPTIONS
        ]
    return []


@router.get("/catalog", response_model=ReportCatalogPublic)
def get_report_catalog(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ReportCatalogPublic:
    _ = current
    svc = ReportService(db)
    plants = [PlantOptionPublic(**p) for p in svc.list_plants()]
    plant_options = [ReportFilterOptionPublic(value="all", label="All plants")] + [
        ReportFilterOptionPublic(value=str(p.id), label=f"{p.name} ({p.code})") for p in plants
    ]

    reports: list[ReportDefinitionPublic] = []
    for report in REPORT_DEFINITIONS:
        filters: list[ReportFilterPublic] = []
        for f in report.filters:
            options = _filter_options(f.kind)
            if f.kind == "plant":
                options = plant_options
            filters.append(
                ReportFilterPublic(
                    key=f.key,
                    label=f.label,
                    kind=f.kind,
                    options=options,
                )
            )
        reports.append(
            ReportDefinitionPublic(
                key=report.key,
                title=report.title,
                description=report.description,
                filters=filters,
            )
        )

    return ReportCatalogPublic(reports=reports, plants=plants)


@router.get("/generate")
def generate_report(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    report: str = Query(..., min_length=1),
    format: str = Query("xlsx", pattern="^(?i)(xlsx|pdf)$"),
    plant_id: int | None = Query(None, ge=1),
    status: str | None = Query(None),
    fy_status: str | None = Query(None),
) -> Response:
    _ = current
    definition = report_by_key(report)
    if definition is None:
        raise HTTPException(status_code=404, detail="Report not found")

    fmt = format.lower()
    svc = ReportService(db)
    try:
        document = svc.build(
            definition.key,
            plant_id=plant_id,
            status=status,
            fy_status=fy_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    content = build_xlsx(document) if fmt == "xlsx" else build_pdf(document)
    filename = report_filename(definition.key, fmt)
    return Response(
        content=content,
        media_type=content_type_for_format(fmt),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
