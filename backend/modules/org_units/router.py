from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.org_units.model import OrgUnit
from modules.org_units.schema import OrgUnitCreate, OrgUnitPublic, OrgUnitUpdate
from modules.org_units.service import (
    DuplicateOrgUnitCodeError,
    NotFoundError,
    OrgUnitService,
)

router = APIRouter(prefix="/org-units", tags=["admin", "org-units"])


def get_org_unit_service(db: Session = Depends(get_db)) -> OrgUnitService:
    return OrgUnitService(db)


@router.get("", response_model=list[OrgUnitPublic])
def list_org_units(
    svc: Annotated[OrgUnitService, Depends(get_org_unit_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "org_units.view",
                "users.create",
                "users.update",
                "roles.create",
                "roles.update",
                "asset.view",
                "asset.create",
                "asset.update",
                "masters.view",
            )
        ),
    ],
    org_type: str | None = Query(None, alias="type"),
) -> list[OrgUnit]:
    return svc.list_org_units(org_type=org_type)


@router.get("/{org_unit_id}", response_model=OrgUnitPublic)
def get_org_unit(
    org_unit_id: int,
    svc: Annotated[OrgUnitService, Depends(get_org_unit_service)],
    _: Annotated[
        object,
        Depends(
            require_any_permission(
                "org_units.view",
                "org_units.update",
            )
        ),
    ],
) -> OrgUnit:
    try:
        return svc.get_org_unit(org_unit_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("", response_model=OrgUnitPublic, status_code=status.HTTP_201_CREATED)
def create_org_unit(
    payload: OrgUnitCreate,
    svc: Annotated[OrgUnitService, Depends(get_org_unit_service)],
    _: Annotated[object, Depends(require_permission("org_units.create"))],
) -> OrgUnit:
    try:
        return svc.create_org_unit(payload)
    except DuplicateOrgUnitCodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A plant with this code already exists.",
        ) from exc


@router.patch("/{org_unit_id}", response_model=OrgUnitPublic)
def update_org_unit(
    org_unit_id: int,
    payload: OrgUnitUpdate,
    svc: Annotated[OrgUnitService, Depends(get_org_unit_service)],
    _: Annotated[object, Depends(require_permission("org_units.update"))],
) -> OrgUnit:
    try:
        return svc.update_org_unit(org_unit_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateOrgUnitCodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A plant with this code already exists.",
        ) from exc
