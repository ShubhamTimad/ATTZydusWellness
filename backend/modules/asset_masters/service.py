from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from modules.assets.model import AssetCategory
from modules.asset_masters.model import (
    ActualLocationMaster,
    AssetConditionMaster,
    AssetCustodianMaster,
    CostCenterMaster,
    FunctionalLocationMaster,
    ProfitCenterMaster,
    TagColorMaster,
)
from modules.asset_masters.schema import (
    AssetConditionCreate,
    AssetConditionPublic,
    AssetConditionUpdate,
    AssetCustodianCreate,
    AssetCustodianPublic,
    AssetCustodianUpdate,
    FunctionalLocationCreate,
    FunctionalLocationPublic,
    FunctionalLocationUpdate,
    CategoryCreate,
    CategoryPublic,
    CategoryUpdate,
    CostCenterCreate,
    CostCenterPublic,
    CostCenterUpdate,
    ProfitCenterCreate,
    ProfitCenterPublic,
    ProfitCenterUpdate,
    ActualLocationCreate,
    ActualLocationPublic,
    ActualLocationUpdate,
    TagColorCreate,
    TagColorPublic,
    TagColorUpdate,
)
from modules.asset_masters.safety import (
    MasterInUseError,
    assert_actual_location_deletable,
    assert_asset_condition_deletable,
    assert_asset_custodian_deletable,
    assert_category_deletable,
    assert_cost_center_deletable,
    assert_functional_location_deletable,
    assert_profit_center_deletable,
    assert_tag_color_deletable,
)
from modules.errors import ConflictError, NotFoundError
from modules.platform.org_units.model import OrgUnit


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

    def delete_category(self, category_id: int) -> None:
        row = self._db.get(AssetCategory, category_id)
        if row is None:
            raise NotFoundError("Category", category_id)
        assert_category_deletable(self._db, category_id)
        self._db.delete(row)
        self._db.commit()

    # --- Tag colors ---

    def list_tag_colors(self, *, active_only: bool = True) -> list[TagColorPublic]:
        stmt = select(TagColorMaster).order_by(TagColorMaster.name)
        if active_only:
            stmt = stmt.where(TagColorMaster.is_active.is_(True))
        rows = list(self._db.scalars(stmt).all())
        return [TagColorPublic.model_validate(r) for r in rows]

    def create_tag_color(self, data: TagColorCreate) -> TagColorPublic:
        row = TagColorMaster(
            code=data.code,
            name=data.name.strip(),
            color_hex=data.color_hex.strip() if data.color_hex else None,
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Tag color code already exists.") from exc
        self._db.refresh(row)
        return TagColorPublic.model_validate(row)

    def update_tag_color(self, row_id: int, data: TagColorUpdate) -> TagColorPublic:
        row = self._db.get(TagColorMaster, row_id)
        if row is None:
            raise NotFoundError("Tag color", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
        if data.color_hex is not None:
            row.color_hex = data.color_hex.strip() or None
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Tag color code already exists.") from exc
        self._db.refresh(row)
        return TagColorPublic.model_validate(row)

    def delete_tag_color(self, row_id: int) -> None:
        row = self._db.get(TagColorMaster, row_id)
        if row is None:
            raise NotFoundError("Tag color", row_id)
        assert_tag_color_deletable(self._db, row_id)
        self._db.delete(row)
        self._db.commit()

    # --- Asset custodians ---

    def list_asset_custodians(self, *, active_only: bool = True) -> list[AssetCustodianPublic]:
        stmt = select(AssetCustodianMaster).order_by(AssetCustodianMaster.name)
        if active_only:
            stmt = stmt.where(AssetCustodianMaster.is_active.is_(True))
        rows = list(self._db.scalars(stmt).all())
        return [AssetCustodianPublic.model_validate(r) for r in rows]

    def create_asset_custodian(self, data: AssetCustodianCreate) -> AssetCustodianPublic:
        row = AssetCustodianMaster(
            code=data.code,
            name=data.name.strip(),
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Asset custodian code already exists.") from exc
        self._db.refresh(row)
        return AssetCustodianPublic.model_validate(row)

    def update_asset_custodian(self, row_id: int, data: AssetCustodianUpdate) -> AssetCustodianPublic:
        row = self._db.get(AssetCustodianMaster, row_id)
        if row is None:
            raise NotFoundError("Asset custodian", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Asset custodian code already exists.") from exc
        self._db.refresh(row)
        return AssetCustodianPublic.model_validate(row)

    def delete_asset_custodian(self, row_id: int) -> None:
        row = self._db.get(AssetCustodianMaster, row_id)
        if row is None:
            raise NotFoundError("Asset custodian", row_id)
        assert_asset_custodian_deletable(self._db, row_id)
        self._db.delete(row)
        self._db.commit()

    # --- Asset conditions ---

    def list_asset_conditions(self, *, active_only: bool = True) -> list[AssetConditionPublic]:
        stmt = select(AssetConditionMaster).order_by(AssetConditionMaster.name)
        if active_only:
            stmt = stmt.where(AssetConditionMaster.is_active.is_(True))
        rows = list(self._db.scalars(stmt).all())
        return [AssetConditionPublic.model_validate(r) for r in rows]

    def create_asset_condition(self, data: AssetConditionCreate) -> AssetConditionPublic:
        row = AssetConditionMaster(
            code=data.code,
            name=data.name.strip(),
            is_active=True,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Asset condition code already exists.") from exc
        self._db.refresh(row)
        return AssetConditionPublic.model_validate(row)

    def update_asset_condition(self, row_id: int, data: AssetConditionUpdate) -> AssetConditionPublic:
        row = self._db.get(AssetConditionMaster, row_id)
        if row is None:
            raise NotFoundError("Asset condition", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
        if data.is_active is not None:
            row.is_active = data.is_active
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateMasterCodeError("Asset condition code already exists.") from exc
        self._db.refresh(row)
        return AssetConditionPublic.model_validate(row)

    def delete_asset_condition(self, row_id: int) -> None:
        row = self._db.get(AssetConditionMaster, row_id)
        if row is None:
            raise NotFoundError("Asset condition", row_id)
        assert_asset_condition_deletable(self._db, row_id)
        self._db.delete(row)
        self._db.commit()

    # --- Cost centers (under plant) ---

    def list_cost_centers(
        self, *, plant_id: int | None = None, active_only: bool = True
    ) -> list[CostCenterPublic]:
        stmt = select(CostCenterMaster).order_by(CostCenterMaster.code)
        if active_only:
            stmt = stmt.where(CostCenterMaster.is_active.is_(True))
        if plant_id is not None:
            stmt = stmt.where(CostCenterMaster.plant_id == plant_id)
        rows = list(self._db.scalars(stmt).all())
        return [self._cost_center_public(r) for r in rows]

    def create_cost_center(self, data: CostCenterCreate) -> CostCenterPublic:
        self._require_plant(data.plant_id)
        name = data.name.strip()
        description = (data.description or "").strip() or name
        row = CostCenterMaster(
            code=data.code,
            name=name,
            description=description,
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
        return self._cost_center_public(row)

    def update_cost_center(self, row_id: int, data: CostCenterUpdate) -> CostCenterPublic:
        row = self._db.get(CostCenterMaster, row_id)
        if row is None:
            raise NotFoundError("Cost center", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
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
        return self._cost_center_public(row)

    def delete_cost_center(self, row_id: int) -> None:
        row = self._db.get(CostCenterMaster, row_id)
        if row is None:
            raise NotFoundError("Cost center", row_id)
        assert_cost_center_deletable(self._db, row)
        self._db.delete(row)
        self._db.commit()

    # --- Profit centers (under cost center) ---

    def list_profit_centers(
        self, *, cost_center_id: int | None = None, plant_id: int | None = None, active_only: bool = True
    ) -> list[ProfitCenterPublic]:
        stmt = select(ProfitCenterMaster).order_by(ProfitCenterMaster.code)
        if active_only:
            stmt = stmt.where(ProfitCenterMaster.is_active.is_(True))
        if cost_center_id is not None:
            stmt = stmt.where(ProfitCenterMaster.cost_center_id == cost_center_id)
        elif plant_id is not None:
            stmt = stmt.join(CostCenterMaster).where(CostCenterMaster.plant_id == plant_id)
        rows = list(self._db.scalars(stmt).all())
        return [self._profit_center_public(r) for r in rows]

    def create_profit_center(self, data: ProfitCenterCreate) -> ProfitCenterPublic:
        cc = self._require_cost_center(data.cost_center_id)
        name = data.name.strip()
        description = (data.description or "").strip() or name
        row = ProfitCenterMaster(
            code=data.code,
            name=name,
            description=description,
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
        return self._profit_center_public(row)

    def update_profit_center(self, row_id: int, data: ProfitCenterUpdate) -> ProfitCenterPublic:
        row = self._db.get(ProfitCenterMaster, row_id)
        if row is None:
            raise NotFoundError("Profit center", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
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
        return self._profit_center_public(row)

    def delete_profit_center(self, row_id: int) -> None:
        row = self._db.get(ProfitCenterMaster, row_id)
        if row is None:
            raise NotFoundError("Profit center", row_id)
        assert_profit_center_deletable(self._db, row)
        self._db.delete(row)
        self._db.commit()

    # --- Functional locations (under plant) ---

    def list_functional_locations(
        self, *, plant_id: int | None = None, active_only: bool = True
    ) -> list[FunctionalLocationPublic]:
        stmt = select(FunctionalLocationMaster).order_by(FunctionalLocationMaster.code)
        if active_only:
            stmt = stmt.where(FunctionalLocationMaster.is_active.is_(True))
        if plant_id is not None:
            stmt = stmt.where(FunctionalLocationMaster.plant_id == plant_id)
        rows = list(self._db.scalars(stmt).all())
        return [self._functional_location_public(r) for r in rows]

    def create_functional_location(self, data: FunctionalLocationCreate) -> FunctionalLocationPublic:
        self._require_plant(data.plant_id)
        name = data.name.strip()
        description = (data.description or "").strip() or name
        row = FunctionalLocationMaster(
            code=data.code,
            name=name,
            description=description,
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
        return self._functional_location_public(row)

    def update_functional_location(
        self, row_id: int, data: FunctionalLocationUpdate
    ) -> FunctionalLocationPublic:
        row = self._db.get(FunctionalLocationMaster, row_id)
        if row is None:
            raise NotFoundError("Functional location", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
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
        return self._functional_location_public(row)

    def delete_functional_location(self, row_id: int) -> None:
        row = self._db.get(FunctionalLocationMaster, row_id)
        if row is None:
            raise NotFoundError("Functional location", row_id)
        assert_functional_location_deletable(self._db, row)
        self._db.delete(row)
        self._db.commit()

    # --- Actual locations (under functional location) ---

    def list_actual_locations(
        self,
        *,
        functional_location_id: int | None = None,
        plant_id: int | None = None,
        active_only: bool = True,
    ) -> list[ActualLocationPublic]:
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
        return [self._actual_location_public(r) for r in rows]

    def create_actual_location(self, data: ActualLocationCreate) -> ActualLocationPublic:
        fl = self._require_functional_location(data.functional_location_id)
        name = data.name.strip()
        description = (data.description or "").strip() or name
        row = ActualLocationMaster(
            code=data.code,
            name=name,
            description=description,
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
        return self._actual_location_public(row)

    def update_actual_location(self, row_id: int, data: ActualLocationUpdate) -> ActualLocationPublic:
        row = self._db.get(ActualLocationMaster, row_id)
        if row is None:
            raise NotFoundError("Actual location", row_id)
        if data.code is not None:
            row.code = data.code
        if data.name is not None:
            row.name = data.name.strip()
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
        return self._actual_location_public(row)

    def delete_actual_location(self, row_id: int) -> None:
        row = self._db.get(ActualLocationMaster, row_id)
        if row is None:
            raise NotFoundError("Actual location", row_id)
        assert_actual_location_deletable(self._db, row)
        self._db.delete(row)
        self._db.commit()

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

    def _cost_center_public(self, row: CostCenterMaster) -> CostCenterPublic:
        plant = self._plant_for(row.plant_id)
        return CostCenterPublic(
            id=row.id,
            code=row.code,
            name=row.name,
            description=row.description,
            plant_id=row.plant_id,
            plant_code=plant.code if plant else None,
            plant_name=plant.name if plant else None,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _functional_location_public(self, row: FunctionalLocationMaster) -> FunctionalLocationPublic:
        plant = self._plant_for(row.plant_id)
        return FunctionalLocationPublic(
            id=row.id,
            code=row.code,
            name=row.name,
            description=row.description,
            plant_id=row.plant_id,
            plant_code=plant.code if plant else None,
            plant_name=plant.name if plant else None,
            is_active=row.is_active,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _profit_center_public(self, row: ProfitCenterMaster) -> ProfitCenterPublic:
        cc = row.cost_center or self._db.get(CostCenterMaster, row.cost_center_id)
        plant = self._plant_for(cc.plant_id) if cc else None
        return ProfitCenterPublic(
            id=row.id,
            code=row.code,
            name=row.name,
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

    def _actual_location_public(self, row: ActualLocationMaster) -> ActualLocationPublic:
        fl = row.functional_location or self._db.get(
            FunctionalLocationMaster, row.functional_location_id
        )
        plant = self._plant_for(fl.plant_id) if fl else None
        return ActualLocationPublic(
            id=row.id,
            code=row.code,
            name=row.name,
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
