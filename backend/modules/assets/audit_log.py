from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from modules.assets.model import AssetAuditEvent


def log_asset_event(
    db: Session,
    *,
    asset_id: int,
    actor_user_id: int | None,
    action: str,
    section: str | None = None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> None:
    db.add(
        AssetAuditEvent(
            asset_id=asset_id,
            actor_user_id=actor_user_id,
            action=action,
            section=section,
            old_value=old_value,
            new_value=new_value,
        )
    )
