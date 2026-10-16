from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from modules.capex.model import CapitalizationFormAudit


def log_capex_event(
    db: Session,
    *,
    form_id: int,
    action: str,
    actor_user_id: int | None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> None:
    db.add(
        CapitalizationFormAudit(
            form_id=form_id,
            action=action,
            actor_user_id=actor_user_id,
            old_value=old_value,
            new_value=new_value,
        )
    )
