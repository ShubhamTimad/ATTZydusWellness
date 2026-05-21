from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from modules.assets.model import AssetCategory
from modules.asset_masters.model import (
    ActualLocationMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
)
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
from modules.errors import ConflictError, NotFoundError
from modules.org_units.model import OrgUnit


class DuplicateMasterCodeError(ConflictError):
    pass


class AssetMastersService:
    def __init__(self, db: Session) -> None:
        self._db = db

    # --- Categories ---

    def list_categories(self, *, active_only: bool = True) -> list[CategoryPublic]:
        stmt = select(AssetCategory).order_by(AssetCategory.name)
        if active_only:
            stmt = stmt.where(AssetCategory.is_active.is_(True))
        rows = list(self._db.scalars(stmt).all())
        return [CategoryPublic.model_validate(r) for r in rows]

    def create_category(self, data: CategoryCreate) -> CategoryPublic:
        row = AssetCategory(
            code=data.code,
            name=data.name.strip(),
            description=data.description.strip() if data.description else None,
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Category code already exists.") from exc
        self._db.refresh(row)
        return CategoryPublic.model_validate(row)

    def update_category(self, category_id: int, data: CategoryUpdate) -> CategoryPublic:
        row = self._db.get(AssetCategory, category_id)
        if row is None:
            raise NotFoundError("Category", category_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
        if data.description is not None:
            row.description = data.description.strip() or None
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Category code already exists.") from exc
        self._db.refresh(row)
        return CategoryPublic.model_validate(row)

    # --- Cost centers (under plant) ---

    def list_cost_centers(
        self, *, plant_id: int | None = None, active_only: bool = True
    ) -> list[PlantChildPublic]:
        stmt = select(CostCenterMaster).order_by(CostCenterMaster.code)
        if active_only:
            stmt = stmt.where(CostCenterMaster.is_active.is_(True))
        if plant_id is not None:
            stmt = stmt.where(CostCenterMaster.plant_id == plant_id)
        rows = list(self._db.scalars(stmt).all())
        return [self._plant_child_public(r) for r in rows]

    def create_cost_center(self, data: PlantChildCreate) -> PlantChildPublic:
        self._require_plant(data.plant_id)
        row = CostCenterMaster(
            code=data.code,
            description=data.description.strip(),
            plant_id=data.plant_id,
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Cost center code already exists for this plant.") from exc
        self._db.refresh(row)
        return self._plant_child_public(row)

    def update_cost_center(self, row_id: int, data: PlantChildUpdate) -> PlantChildPublic:
        row = self._db.get(CostCenterMaster, row_id)
        if row is None:
            raise NotFoundError("Cost center", row_id)
        if data.code is not None:
            row.code = data.code
        if data.description is not None:
            row.description = data.description.strip()
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Cost center code already exists for this plant.") from exc
        self._db.refresh(row)
        return self._plant_child_public(row)

    # --- Profit centers (under cost center) ---

    def list_profit_centers(
        self, *, cost_center_id: int | None = None, plant_id: int | None = None, active_only: bool = True
    ) -> list[CostCenterChildPublic]:
        stmt = select(ProfitCenterMaster).order_by(ProfitCenterMaster.code)
        if active_only:
            stmt = stmt.where(ProfitCenterMaster.is_active.is_(True))
        if cost_center_id is not None:
            stmt = stmt.where(ProfitCenterMaster.cost_center_id == cost_center_id)
        elif plant_id is not None:
            stmt = stmt.join(CostCenterMaster).where(CostCenterMaster.plant_id == plant_id)
        rows = list(self._db.scalars(stmt).all())
        return [self._profit_public(r) for r in rows]

    def create_profit_center(self, data: CostCenterChildCreate) -> CostCenterChildPublic:
        cc = self._require_cost_center(data.cost_center_id)
        row = ProfitCenterMaster(
            code=data.code,
            description=data.description.strip(),
            cost_center_id=cc.id,
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError(
                "Profit center code already exists for this cost center."
            ) from exc
        self._db.refresh(row)
        return self._profit_public(row)

    def update_profit_center(self, row_id: int, data: PlantChildUpdate) -> CostCenterChildPublic:
        row = self._db.get(ProfitCenterMaster, row_id)
        if row is None:
            raise NotFoundError("Profit center", row_id)
        if data.code is not None:
            row.code = data.code
        if data.description is not None:
            row.description = data.description.strip()
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError(
                "Profit center code already exists for this cost center."
            ) from exc
        self._db.refresh(row)
        return self._profit_public(row)

    # --- Functional locations (under plant) ---

    def list_functional_locations(
        self, *, plant_id: int | None = None, active_only: bool = True
    ) -> list[PlantChildPublic]:
        stmt = select(FunctionalLocationMaster).order_by(FunctionalLocationMaster.code)
        if active_only:
            stmt = stmt.where(FunctionalLocationMaster.is_active.is_(True))
        if plant_id is not None:
            stmt = stmt.where(FunctionalLocationMaster.plant_id == plant_id)
        rows = list(self._db.scalars(stmt).all())
        return [self._plant_child_public_fl(r) for r in rows]

    def create_functional_location(self, data: PlantChildCreate) -> PlantChildPublic:
        self._require_plant(data.plant_id)
        row = FunctionalLocationMaster(
            code=data.code,
            description=data.description.strip(),
            plant_id=data.plant_id,
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError(
                "Functional location code already exists for this plant."
            ) from exc
        self._db.refresh(row)
        return self._plant_child_public_fl(row)

    def update_functional_location(self, row_id: int, data: PlantChildUpdate) -> PlantChildPublic:
        row = self._db.get(FunctionalLocationMaster, row_id)
        if row is None:
            raise NotFoundError("Functional location", row_id)
        if data.code is not None:
            row.code = data.code
        if data.description is not None:
            row.description = data.description.strip()
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError(
                "Functional location code already exists for this plant."
            ) from exc
        self._db.refresh(row)
        return self._plant_child_public_fl(row)

    # --- Actual locations (under functional location) ---

    def list_actual_locations(
        self,
        *,
        functional_location_id: int | None = None,
        plant_id: int | None = None,
        active_only: bool = True,
    ) -> list[FunctionalChildPublic]:
        stmt = select(ActualLocationMaster).order_by(ActualLocationMaster.code)
        if active_only:
            stmt = stmt.where(ActualLocationMaster.is_active.is_(True))
        if functional_location_id is not None:
            stmt = stmt.where(ActualLocationMaster.functional_location_id == functional_location_id)
        elif plant_id is not None:
            stmt = stmt.join(FunctionalLocationMaster).where(
                FunctionalLocationMaster.plant_id == plant_id
            )
        rows = list(self._db.scalars(stmt).all())
        return [self._actual_public(r) for r in rows]

    def create_actual_location(self, data: FunctionalChildCreate) -> FunctionalChildPublic:
        fl = self._require_functional_location(data.functional_location_id)
        row = ActualLocationMaster(
            code=data.code,
            description=data.description.strip(),
            functional_location_id=fl.id,
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError(
                "Actual location code already exists for this functional location."
            ) from exc
        self._db.refresh(row)
        return self._actual_public(row)

    def update_actual_location(self, row_id: int, data: PlantChildUpdate) -> FunctionalChildPublic:
        row = self._db.get(ActualLocationMaster, row_id)
        if row is None:
            raise NotFoundError("Actual location", row_id)
        if data.code is not None:
            row.code = data.code
        if data.description is not None:
            row.description = data.description.strip()
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError(
                "Actual location code already exists for this functional location."
            ) from exc
        self._db.refresh(row)
        return self._actual_public(row)

    def _require_plant(self, plant_id: int) -> OrgUnit:
        plant = self._db.get(OrgUnit, plant_id)
        if plant is None or plant.type != "PLANT":
            raise NotFoundError("Plant", plant_id)
        return plant

    def _require_cost_center(self, cost_center_id: int) -> CostCenterMaster:
        row = self._db.get(CostCenterMaster, cost_center_id)
        if row is None:
            raise NotFoundError("Cost center", cost_center_id)
        return row

    def _require_functional_location(self, fl_id: int) -> FunctionalLocationMaster:
        row = self._db.get(FunctionalLocationMaster, fl_id)
        if row is None:
            raise NotFoundError("Functional location", fl_id)
        return row

    def _plant_for(self, plant_id: int) -> OrgUnit | None:
        return self._db.get(OrgUnit, plant_id)

    def _plant_child_public(self, row: CostCenterMaster) -> PlantChildPublic:
        plant = self._plant_for(row.plant_id)
        return PlantChildPublic(
            id=row.id,
            code=row.code,
            description=row.description,
            plant_id=row.plant_id,
            plant_code=plant.code if plant else None,
            plant_name=plant.name if plant else None,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _plant_child_public_fl(self, row: FunctionalLocationMaster) -> PlantChildPublic:
        plant = self._plant_for(row.plant_id)
        return PlantChildPublic(
            id=row.id,
            code=row.code,
            description=row.description,
            plant_id=row.plant_id,
            plant_code=plant.code if plant else None,
            plant_name=plant.name if plant else None,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _profit_public(self, row: ProfitCenterMaster) -> CostCenterChildPublic:
        cc = row.cost_center or self._db.get(CostCenterMaster, row.cost_center_id)
        plant = self._plant_for(cc.plant_id) if cc else None
        return CostCenterChildPublic(
            id=row.id,
            code=row.code,
            description=row.description,
            cost_center_id=row.cost_center_id,
            cost_center_code=cc.code if cc else None,
            plant_id=cc.plant_id if cc else None,
            plant_code=plant.code if plant else None,
            plant_name=plant.name if plant else None,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _actual_public(self, row: ActualLocationMaster) -> FunctionalChildPublic:
        fl = row.functional_location or self._db.get(
            FunctionalLocationMaster, row.functional_location_id
        )
        plant = self._plant_for(fl.plant_id) if fl else None
        return FunctionalChildPublic(
            id=row.id,
            code=row.code,
            description=row.description,
            functional_location_id=row.functional_location_id,
            functional_location_code=fl.code if fl else None,
            plant_id=fl.plant_id if fl else None,
            plant_code=plant.code if plant else None,
            plant_name=plant.name if plant else None,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
