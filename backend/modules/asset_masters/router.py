from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import (
    _get_cached_permission_snapshot,
    _has_any_permission,
    require_any_permission,
    require_permission,
)
from db.session import get_db
from modules.asset_masters.schema import (
    CategoryCreate,
    CategoryPublic,
    CategoryUpdate,
    CostCenterCreate,
    CostCenterPublic,
    CostCenterUpdate,
    CostCenterCustodianAssignmentPublic,
    CostCenterCustodiansPublic,
    CostCenterCustodiansReplaceRequest,
    CostCenterCustodianUserPublic,
    ProfitCenterCreate,
    ProfitCenterPublic,
    ProfitCenterUpdate,
    ActualLocationCreate,
    ActualLocationPublic,
    ActualLocationUpdate,
    FunctionalLocationCreate,
    FunctionalLocationPublic,
    FunctionalLocationUpdate,
    TagColorCreate,
    TagColorPublic,
    TagColorUpdate,
    AssetClassCreate,
    AssetClassPublic,
    AssetClassUpdate,
    AssetConditionCreate,
    AssetConditionPublic,
    AssetConditionUpdate,
    AssetCustodianCreate,
    AssetCustodianPublic,
    AssetCustodianUpdate,
    MasterSetActiveRequest,
)
from modules.asset_masters.safety import MasterInUseError
from modules.asset_masters.service import AssetMastersService, DuplicateMasterCodeError
from modules.errors import NotFoundError

router = APIRouter(prefix="/asset-masters", tags=["admin", "asset-masters"])

_MASTER_READ = require_any_permission("masters.view", "asset.view")
_COST_CENTER_READ = require_any_permission(
    "masters.view",
    "asset.view",
    "users.create",
    "users.update",
    "capitalization.view",
)
_MASTER_WRITE_CREATE = require_permission("masters.create")
_MASTER_WRITE_UPDATE = require_permission("masters.update")
_MASTER_WRITE_DELETE = require_permission("masters.delete")


def get_svc(db: Session = Depends(get_db)) -> AssetMastersService:
    return AssetMastersService(db)


def _raise_master_errors(exc: Exception) -> None:
    if isinstance(exc, NotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, DuplicateMasterCodeError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, MasterInUseError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise exc


def _assert_may_set_active(*, is_active: bool, current: CurrentUser, db: Session) -> None:
    snapshot = _get_cached_permission_snapshot(db, int(current.subject))
    if _has_any_permission(snapshot, ("masters.update",)):
        return
    need = "masters.reactivate" if is_active else "masters.deactivate"
    if not _has_any_permission(snapshot, (need,)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing permission: {need}",
        )

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


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_category(category_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/tag-colors", response_model=list[TagColorPublic])
def list_tag_colors(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    active_only: bool = Query(True),
) -> list[TagColorPublic]:
    return svc.list_tag_colors(active_only=active_only)


@router.post("/tag-colors", response_model=TagColorPublic, status_code=status.HTTP_201_CREATED)
def create_tag_color(
    payload: TagColorCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> TagColorPublic:
    try:
        return svc.create_tag_color(payload)
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/tag-colors/{row_id}", response_model=TagColorPublic)
def update_tag_color(
    row_id: int,
    payload: TagColorUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> TagColorPublic:
    try:
        return svc.update_tag_color(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/tag-colors/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag_color(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_tag_color(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/asset-custodians", response_model=list[AssetCustodianPublic])
def list_asset_custodians(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    active_only: bool = Query(True),
) -> list[AssetCustodianPublic]:
    return svc.list_asset_custodians(active_only=active_only)


@router.post("/asset-custodians", response_model=AssetCustodianPublic, status_code=status.HTTP_201_CREATED)
def create_asset_custodian(
    payload: AssetCustodianCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> AssetCustodianPublic:
    try:
        return svc.create_asset_custodian(payload)
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/asset-custodians/{row_id}", response_model=AssetCustodianPublic)
def update_asset_custodian(
    row_id: int,
    payload: AssetCustodianUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> AssetCustodianPublic:
    try:
        return svc.update_asset_custodian(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/asset-custodians/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_custodian(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_asset_custodian(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/asset-conditions", response_model=list[AssetConditionPublic])
def list_asset_conditions(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    active_only: bool = Query(True),
) -> list[AssetConditionPublic]:
    return svc.list_asset_conditions(active_only=active_only)


@router.post("/asset-conditions", response_model=AssetConditionPublic, status_code=status.HTTP_201_CREATED)
def create_asset_condition(
    payload: AssetConditionCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> AssetConditionPublic:
    try:
        return svc.create_asset_condition(payload)
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/asset-conditions/{row_id}", response_model=AssetConditionPublic)
def update_asset_condition(
    row_id: int,
    payload: AssetConditionUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> AssetConditionPublic:
    try:
        return svc.update_asset_condition(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/asset-conditions/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_condition(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_asset_condition(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/asset-classes", response_model=list[AssetClassPublic])
def list_asset_classes(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    active_only: bool = Query(True),
) -> list[AssetClassPublic]:
    return svc.list_asset_classes(active_only=active_only)


@router.post("/asset-classes", response_model=AssetClassPublic, status_code=status.HTTP_201_CREATED)
def create_asset_class(
    payload: AssetClassCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> AssetClassPublic:
    try:
        return svc.create_asset_class(payload)
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/asset-classes/{row_id}", response_model=AssetClassPublic)
def update_asset_class(
    row_id: int,
    payload: AssetClassUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> AssetClassPublic:
    try:
        return svc.update_asset_class(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/asset-classes/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_class(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_asset_class(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/cost-centers", response_model=list[CostCenterPublic])
def list_cost_centers(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(_COST_CENTER_READ)],
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
    scrapyard_only: bool = Query(
        False,
        description="When true, only cost centers marked is_scrapyard (disposal destination).",
    ),
    for_asset_list: bool = Query(
        False,
        description=(
            "When true, return plant-scoped cost centers for asset list filters "
            "(not limited to the viewer's assigned cost centers)."
        ),
    ),
) -> list[CostCenterPublic]:
    return svc.list_cost_centers(
        plant_id=plant_id,
        active_only=active_only,
        scrapyard_only=scrapyard_only,
        for_asset_list=for_asset_list,
        viewer_user_id=int(current.subject),
    )


@router.post("/cost-centers", response_model=CostCenterPublic, status_code=status.HTTP_201_CREATED)
def create_cost_center(
    payload: CostCenterCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> CostCenterPublic:
    try:
        return svc.create_cost_center(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/cost-centers/{row_id}", response_model=CostCenterPublic)
def update_cost_center(
    row_id: int,
    payload: CostCenterUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> CostCenterPublic:
    try:
        return svc.update_cost_center(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/cost-centers/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cost_center(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_cost_center(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get(
    "/cost-center-custodians",
    response_model=list[CostCenterCustodianAssignmentPublic],
)
def list_cost_center_custodian_assignments(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
    plant_id: int | None = Query(None),
    cost_center_id: int | None = Query(None),
) -> list[CostCenterCustodianAssignmentPublic]:
    return svc.list_cost_center_custodian_assignments(
        plant_id=plant_id,
        cost_center_id=cost_center_id,
    )


@router.get(
    "/cost-center-custodian-users",
    response_model=list[CostCenterCustodianUserPublic],
)
def list_users_for_custodian_assignment(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
) -> list[CostCenterCustodianUserPublic]:
    return svc.list_users_for_custodian_assignment()


@router.get(
    "/cost-centers/{cost_center_id}/custodians",
    response_model=CostCenterCustodiansPublic,
)
def list_cost_center_custodians(
    cost_center_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_READ)],
) -> CostCenterCustodiansPublic:
    try:
        return svc.list_cost_center_custodians(cost_center_id=cost_center_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.put(
    "/cost-centers/{cost_center_id}/custodians",
    response_model=CostCenterCustodiansPublic,
)
def replace_cost_center_custodians(
    cost_center_id: int,
    payload: CostCenterCustodiansReplaceRequest,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> CostCenterCustodiansPublic:
    try:
        return svc.replace_cost_center_custodians(cost_center_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/profit-centers", response_model=list[ProfitCenterPublic])
def list_profit_centers(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(_MASTER_READ)],
    cost_center_id: int | None = Query(None),
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
) -> list[ProfitCenterPublic]:
    return svc.list_profit_centers(
        cost_center_id=cost_center_id,
        plant_id=plant_id,
        active_only=active_only,
        viewer_user_id=int(current.subject),
    )


@router.post("/profit-centers", response_model=ProfitCenterPublic, status_code=status.HTTP_201_CREATED)
def create_profit_center(
    payload: ProfitCenterCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> ProfitCenterPublic:
    try:
        return svc.create_profit_center(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/profit-centers/{row_id}", response_model=ProfitCenterPublic)
def update_profit_center(
    row_id: int,
    payload: ProfitCenterUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> ProfitCenterPublic:
    try:
        return svc.update_profit_center(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/profit-centers/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profit_center(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_profit_center(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/functional-locations", response_model=list[FunctionalLocationPublic])
def list_functional_locations(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(_MASTER_READ)],
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
    scrapyard_only: bool = Query(
        False,
        description="When true, only functional locations marked is_scrapyard (disposal receive).",
    ),
) -> list[FunctionalLocationPublic]:
    return svc.list_functional_locations(
        plant_id=plant_id,
        active_only=active_only,
        scrapyard_only=scrapyard_only,
        viewer_user_id=int(current.subject),
    )


@router.post(
    "/functional-locations",
    response_model=FunctionalLocationPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_functional_location(
    payload: FunctionalLocationCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> FunctionalLocationPublic:
    try:
        return svc.create_functional_location(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/functional-locations/{row_id}", response_model=FunctionalLocationPublic)
def update_functional_location(
    row_id: int,
    payload: FunctionalLocationUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> FunctionalLocationPublic:
    try:
        return svc.update_functional_location(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/functional-locations/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_functional_location(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_functional_location(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.get("/actual-locations", response_model=list[ActualLocationPublic])
def list_actual_locations(
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    current: Annotated[CurrentUser, Depends(get_current_user)],
    _: Annotated[object, Depends(_MASTER_READ)],
    functional_location_id: int | None = Query(None),
    plant_id: int | None = Query(None),
    active_only: bool = Query(True),
) -> list[ActualLocationPublic]:
    return svc.list_actual_locations(
        functional_location_id=functional_location_id,
        plant_id=plant_id,
        active_only=active_only,
        viewer_user_id=int(current.subject),
    )


@router.post("/actual-locations", response_model=ActualLocationPublic, status_code=status.HTTP_201_CREATED)
def create_actual_location(
    payload: ActualLocationCreate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_CREATE)],
) -> ActualLocationPublic:
    try:
        return svc.create_actual_location(payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/actual-locations/{row_id}", response_model=ActualLocationPublic)
def update_actual_location(
    row_id: int,
    payload: ActualLocationUpdate,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_UPDATE)],
) -> ActualLocationPublic:
    try:
        return svc.update_actual_location(row_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateMasterCodeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/actual-locations/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_actual_location(
    row_id: int,
    svc: Annotated[AssetMastersService, Depends(get_svc)],
    _: Annotated[object, Depends(_MASTER_WRITE_DELETE)],
) -> None:
    try:
        svc.delete_actual_location(row_id)
    except (NotFoundError, DuplicateMasterCodeError, MasterInUseError) as exc:
        _raise_master_errors(exc)


@router.post("/categories/{row_id}/set-active", response_model=CategoryPublic)
def set_category_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> CategoryPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_category(row_id, CategoryUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/tag-colors/{row_id}/set-active", response_model=TagColorPublic)
def set_tag_color_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> TagColorPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_tag_color(row_id, TagColorUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/asset-custodians/{row_id}/set-active", response_model=AssetCustodianPublic)
def set_asset_custodian_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> AssetCustodianPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_asset_custodian(row_id, AssetCustodianUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/asset-conditions/{row_id}/set-active", response_model=AssetConditionPublic)
def set_asset_condition_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> AssetConditionPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_asset_condition(row_id, AssetConditionUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/asset-classes/{row_id}/set-active", response_model=AssetClassPublic)
def set_asset_class_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> AssetClassPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_asset_class(row_id, AssetClassUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/cost-centers/{row_id}/set-active", response_model=CostCenterPublic)
def set_cost_center_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> CostCenterPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_cost_center(row_id, CostCenterUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/profit-centers/{row_id}/set-active", response_model=ProfitCenterPublic)
def set_profit_center_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> ProfitCenterPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_profit_center(row_id, ProfitCenterUpdate(is_active=payload.is_active))
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/functional-locations/{row_id}/set-active", response_model=FunctionalLocationPublic)
def set_functional_location_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> FunctionalLocationPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_functional_location(
            row_id, FunctionalLocationUpdate(is_active=payload.is_active)
        )
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise


@router.post("/actual-locations/{row_id}/set-active", response_model=ActualLocationPublic)
def set_actual_location_active(
    row_id: int,
    payload: MasterSetActiveRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    svc: Annotated[AssetMastersService, Depends(get_svc)],
) -> ActualLocationPublic:
    _assert_may_set_active(is_active=payload.is_active, current=current, db=db)
    try:
        return svc.update_actual_location(
            row_id, ActualLocationUpdate(is_active=payload.is_active)
        )
    except (NotFoundError, DuplicateMasterCodeError) as exc:
        _raise_master_errors(exc)
        raise
