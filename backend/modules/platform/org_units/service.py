from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from modules.platform.org_units.model import OrgUnit
from modules.platform.org_units.schema import OrgUnitCreate, OrgUnitUpdate
from modules.platform.users.scope import load_viewer_org_scope
from modules.rbac_safety import assert_org_unit_not_assigned_to_any_user


class NotFoundError(Exception):
    def __init__(self, entity: str, entity_id: int) -> None:
        self.entity = entity
        self.entity_id = entity_id
        super().__init__(f"{entity} {entity_id} not found")


class DuplicateOrgUnitCodeError(Exception):
    pass


class OrgUnitService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _org_units_stmt(
        self,
        *,
        org_type: str | None = None,
        parent_id: int | None = None,
        viewer_user_id: int | None = None,
    ):
        scope = load_viewer_org_scope(self._db, viewer_user_id)
        stmt = select(OrgUnit)
        if org_type:
            stmt = stmt.where(OrgUnit.type == org_type)
        if parent_id is not None:
            stmt = stmt.where(OrgUnit.parent_id == parent_id)

        # Restrict plant dropdowns / lookups for scoped operators.
        plant_ids = scope.plant_ids
        if plant_ids is None and scope.cost_center_keys is not None:
            plant_ids = frozenset(pid for pid, _ in scope.cost_center_keys)
        if plant_ids is not None:
            type_u = (org_type or "").strip().upper()
            if type_u == "PLANT" or (not org_type and parent_id is None):
                if not plant_ids:
                    return None
                if type_u == "PLANT":
                    stmt = stmt.where(OrgUnit.id.in_(plant_ids))
                else:
                    # Mixed list: keep non-plants + scoped plants only.
                    stmt = stmt.where(
                        or_(OrgUnit.type != "PLANT", OrgUnit.id.in_(plant_ids))
                    )
            elif type_u == "DEPARTMENT" and plant_ids:
                stmt = stmt.where(OrgUnit.parent_id.in_(plant_ids))
        return stmt

    def list_org_units(
        self,
        *,
        org_type: str | None = None,
        parent_id: int | None = None,
        viewer_user_id: int | None = None,
    ) -> list[OrgUnit]:
        stmt = self._org_units_stmt(
            org_type=org_type,
            parent_id=parent_id,
            viewer_user_id=viewer_user_id,
        )
        if stmt is None:
            return []
        return list(self._db.scalars(stmt.order_by(OrgUnit.name.asc())).all())

    def list_org_units_page(
        self,
        *,
        page: int,
        page_size: int,
        org_type: str | None = None,
        parent_id: int | None = None,
        viewer_user_id: int | None = None,
    ) -> tuple[list[OrgUnit], int]:
        stmt = self._org_units_stmt(
            org_type=org_type,
            parent_id=parent_id,
            viewer_user_id=viewer_user_id,
        )
        if stmt is None:
            return [], 0
        total = int(self._db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
        offset = max(page - 1, 0) * page_size
        items = list(
            self._db.scalars(
                stmt.order_by(OrgUnit.code.asc(), OrgUnit.name.asc()).offset(offset).limit(page_size)
            ).all()
        )
        return items, total

    def get_org_unit(self, org_unit_id: int) -> OrgUnit:
        row = self._db.get(OrgUnit, org_unit_id)
        if row is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        return row

    def create_org_unit(self, data: OrgUnitCreate) -> OrgUnit:
        org_type = data.type.strip().upper()
        parent_id = data.parent_id
        if org_type == "DEPARTMENT":
            if parent_id is None:
                raise ValueError("Department must belong to a plant")
            parent = self._db.get(OrgUnit, parent_id)
            if parent is None:
                raise NotFoundError("OrgUnit", parent_id)
            if (parent.type or "").upper() != "PLANT":
                raise ValueError("Department parent must be a plant")
        elif org_type == "PLANT":
            parent_id = None

        row = OrgUnit(
            name=data.name.strip(),
            code=data.code,
            type=org_type,
            parent_id=parent_id,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateOrgUnitCodeError from exc
        self._db.refresh(row)
        return row

    def update_org_unit(self, org_unit_id: int, data: OrgUnitUpdate) -> OrgUnit:
        row = self.get_org_unit(org_unit_id)
        row.name = data.name.strip()
        row.code = data.code
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateOrgUnitCodeError from exc
        self._db.refresh(row)
        return row

    def delete_org_unit(self, org_unit_id: int) -> None:
        assert_org_unit_not_assigned_to_any_user(self._db, org_unit_id)
        row = self.get_org_unit(org_unit_id)
        child = self._db.scalar(select(OrgUnit.id).where(OrgUnit.parent_id == org_unit_id).limit(1))
        if child is not None:
            raise ValueError("Cannot delete this organizational unit while child departments still exist.")
        self._db.delete(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateOrgUnitCodeError from exc
