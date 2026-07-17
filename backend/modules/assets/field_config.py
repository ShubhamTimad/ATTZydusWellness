"""Load and apply asset field display configuration from the database."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.assets.field_config_seed import ASSET_FIELD_CONFIG_SEED
from modules.assets.field_definitions import ASSET_FIELD_LABELS
from modules.assets.model import AssetFieldConfig

_NULLABLE_ID_FIELDS = frozenset({"asset_category_id", "plant_id"})


@dataclass(frozen=True)
class FieldConfigEntry:
    field_key: str
    display_label: str
    is_visible: bool
    is_required: bool


def _fallback_label(field_key: str) -> str:
    return ASSET_FIELD_LABELS.get(field_key, field_key.replace("_", " ").title())


def _seed_rows() -> list[FieldConfigEntry]:
    return [
        FieldConfigEntry(
            field_key=row["field_key"],
            display_label=row["display_label"],
            is_visible=row["is_visible"],
            is_required=row["is_required"],
        )
        for row in ASSET_FIELD_CONFIG_SEED
    ]


class AssetFieldConfigService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._cache: dict[str, FieldConfigEntry] | None = None

    def _load(self) -> dict[str, FieldConfigEntry]:
        if self._cache is not None:
            return self._cache
        rows = self._db.scalars(select(AssetFieldConfig).order_by(AssetFieldConfig.field_key)).all()
        if not rows:
            self._cache = {r.field_key: r for r in _seed_rows()}
            return self._cache
        self._cache = {
            row.field_key: FieldConfigEntry(
                field_key=row.field_key,
                display_label=row.display_label,
                is_visible=row.is_visible,
                is_required=row.is_required,
            )
            for row in rows
        }
        return self._cache

    def list_all(self) -> list[FieldConfigEntry]:
        return list(self._load().values())

    def get(self, field_key: str) -> FieldConfigEntry | None:
        return self._load().get(field_key)

    def label(self, field_key: str) -> str:
        entry = self.get(field_key)
        return entry.display_label if entry else _fallback_label(field_key)

    def is_visible(self, field_key: str, *, default: bool = True) -> bool:
        entry = self.get(field_key)
        if entry is None:
            return default
        return entry.is_visible

    def is_required(self, field_key: str, *, default: bool = False) -> bool:
        entry = self.get(field_key)
        if entry is None:
            return default
        return entry.is_required

    def required_keys(self) -> frozenset[str]:
        return frozenset(k for k, v in self._load().items() if v.is_required)

    def label_map(self) -> dict[str, str]:
        known = self._load()
        labels = dict(ASSET_FIELD_LABELS)
        labels.update({k: v.display_label for k, v in known.items()})
        return labels


def _required_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def validate_required_fields(
    svc: AssetFieldConfigService,
    values: dict[str, Any],
    *,
    scope_keys: frozenset[str] | None = None,
) -> dict[str, str]:
    """Return field_key -> error message for missing required values in scope."""
    errors: dict[str, str] = {}
    for field_key in svc.required_keys():
        if scope_keys is not None and field_key not in scope_keys:
            continue
        if field_key not in values:
            continue
        value = values.get(field_key)
        if field_key in _NULLABLE_ID_FIELDS:
            if value is None:
                errors[field_key] = f"{svc.label(field_key)} is required."
            continue
        if not _required_text(value):
            errors[field_key] = f"{svc.label(field_key)} is required."
    return errors


MANUAL_CREATE_SCOPE = frozenset(
    {
        "asset_name",
        "combined_asset_number",
        "asset_category_id",
        "plant_id",
        "cost_center",
        "functional_location",
        "actual_location",
    }
)

IMPORT_SCOPE = frozenset(
    {
        "asset_name",
        "combined_asset_number",
        "category_code",
        "plant_code",
        "cost_center",
        "functional_location",
        "actual_location",
    }
)
