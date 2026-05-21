from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.permissions import require_any_permission, require_permission
from db.session import get_db
from modules.asset_masters.schema import (
    CategoryCreate,
    CategoryPublic,
    CategoryUpdate,
    CostCenterChildCreate,
    CostCenterChildPublic,
    FunctionalChildCreate,
    FunctionalChildPublic,
    PlantChildCreate,
    PlantChildPublic,
    PlantChildUpdate,
)
from modules.asset_masters.service import AssetMastersService, DuplicateMasterCodeError
from modules.errors import NotFoundError

router = APIRouter(prefix="/asset-masters", tags=["admin", "asset-masters"])

_MASTER_READ = require_any_permission("masters.view", "asset.view")
_MASTER_WRITE_CREATE = require_permission("masters.create")
_MASTER_WRITE_UPDATE = require_permission("masters.update")


def get_svc(db: Session = Depends(get_db)) -> AssetMastersService:
    return AssetMastersService(db)


@router.get("/categories", response_model=list[CategoryPublic])
def list_categories(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    active_only: bool = Query(True),
) -> list[CategoryPublic]:
    return svc.list_categories(active_only=active_only)


@router.post("/categories", response_model=CategoryPublic, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> CategoryPublic:
    try:
        return svc.create_category(payload)
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/categories/{category_id}", response_model=CategoryPublic)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> CategoryPublic:
    try:
        return svc.update_category(category_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/cost-centers", response_model=list[PlantChildPublic])
def list_cost_centers(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
) -> list[PlantChildPublic]:
    return svc.list_cost_centers(plant_id=plant_id, active_only=active_only)


@router.post("/cost-centers", response_model=PlantChildPublic, status_code=status.HTTP_201_CREATED)
def create_cost_center(
    payload: PlantChildCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> PlantChildPublic:
    try:
        return svc.create_cost_center(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/cost-centers/{row_id}", response_model=PlantChildPublic)
def update_cost_center(
    row_id: int,
    payload: PlantChildUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> PlantChildPublic:
    try:
        return svc.update_cost_center(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/profit-centers", response_model=list[CostCenterChildPublic])
def list_profit_centers(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    cost_center_id: int | None = Query(None),
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
) -> list[CostCenterChildPublic]:
    return svc.list_profit_centers(
        cost_center_id=cost_center_id, plant_id=plant_id, active_only=active_only
    )


@router.post("/profit-centers", response_model=CostCenterChildPublic, status_code=status.HTTP_201_CREATED)
def create_profit_center(
    payload: CostCenterChildCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> CostCenterChildPublic:
    try:
        return svc.create_profit_center(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/profit-centers/{row_id}", response_model=CostCenterChildPublic)
def update_profit_center(
    row_id: int,
    payload: PlantChildUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> CostCenterChildPublic:
    try:
        return svc.update_profit_center(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/functional-locations", response_model=list[PlantChildPublic])
def list_functional_locations(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
) -> list[PlantChildPublic]:
    return svc.list_functional_locations(plant_id=plant_id, active_only=active_only)


@router.post(
    "/functional-locations", response_model=PlantChildPublic, status_code=status.HTTP_201_CREATED
)
def create_functional_location(
    payload: PlantChildCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> PlantChildPublic:
    try:
        return svc.create_functional_location(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/functional-locations/{row_id}", response_model=PlantChildPublic)
def update_functional_location(
    row_id: int,
    payload: PlantChildUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> PlantChildPublic:
    try:
        return svc.update_functional_location(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/actual-locations", response_model=list[FunctionalChildPublic])
def list_actual_locations(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    functional_location_id: int | None = Query(None),
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
) -> list[FunctionalChildPublic]:
    return svc.list_actual_locations(
        functional_location_id=functional_location_id,
        plant_id=plant_id,
        active_only=active_only,
    )


@router.post("/actual-locations", response_model=FunctionalChildPublic, status_code=status.HTTP_201_CREATED)
def create_actual_location(
    payload: FunctionalChildCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> FunctionalChildPublic:
    try:
        return svc.create_actual_location(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/actual-locations/{row_id}", response_model=FunctionalChildPublic)
def update_actual_location(
    row_id: int,
    payload: PlantChildUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> FunctionalChildPublic:
    try:
        return svc.update_actual_location(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
