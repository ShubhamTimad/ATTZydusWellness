from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from db.session import get_db
from modules.assets.service import AssetMasterService
from modules.reports.definitions import REPORT_DEFINITIONS, report_by_key
from modules.reports.export import build_pdf, build_xlsx, content_type_for_format, report_filename
from modules.reports.schema import (
    PlantOptionPublic,
    ReportCatalogPublic,
    ReportDefinitionPublic,
    ReportFilterOptionPublic,
    ReportFilterPublic,
)
from modules.reports.service import FY_STATUS_LABELS, FY_STATUS_OPTIONS, ORDER_STATUS_OPTIONS, ReportService


router = APIRouter(prefix="/reports", tags=["reports"])


def _filter_options(kind: str, *, plant_options: list[ReportFilterOptionPublic], category_options: list[ReportFilterOptionPublic]) -> list[ReportFilterOptionPublic]:
    if kind == "plant":
        return plant_options
    if kind == "category":
        return category_options
    if kind in ("cost_center", "functional_location", "actual_location"):
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
            ReportFilterOptionPublic(value=s, label=FY_STATUS_LABELS.get(s, s.replace("_", " ").title()))
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
    category_options = [ReportFilterOptionPublic(value="all", label="All categories")] + [
        ReportFilterOptionPublic(value=str(c.id), label=f"{c.name} ({c.code})") for c in svc.list_categories()
    ]

    reports: list[ReportDefinitionPublic] = []
    for report in REPORT_DEFINITIONS:
        filters: list[ReportFilterPublic] = []
        for f in report.filters:
            options = _filter_options(
                f.kind,
                plant_options=plant_options,
                category_options=category_options,
            )
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
                formats=list(report.formats),
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
    category_id: int | None = Query(None, ge=1),
    cost_center: str | None = Query(None),
    functional_location: str | None = Query(None),
    actual_location: str | None = Query(None),
    status: str | None = Query(None),
    fy_status: str | None = Query(None),
) -> Response:
    _ = current
    definition = report_by_key(report)
    if definition is None:
        raise HTTPException(status_code=404, detail="Report not found")

    fmt = format.lower()
    if fmt not in definition.formats:
        allowed = ", ".join(definition.formats)
        raise HTTPException(status_code=400, detail=f"This report is only available as: {allowed}")

    if definition.key == "asset_register":
        from modules.assets.field_definitions import ASSET_EXPORT_DEFAULT_FIELDS

        asset_svc = AssetMasterService(db)
        content, filename, media_type = asset_svc.export_assets(
            fields=list(ASSET_EXPORT_DEFAULT_FIELDS),
            plant_id=plant_id,
            category_id=category_id,
            cost_center=cost_center,
            functional_location=functional_location,
            actual_location=actual_location,
        )
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

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
