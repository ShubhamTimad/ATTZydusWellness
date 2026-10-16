"""Read-only audit-style timelines for domain entities."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import _get_cached_permission_snapshot, _has_any_permission, _has_permissions
from db.session import get_db
from modules.platform.approvals.service import ApprovalError
from modules.platform.approvals.timeline_service import ApprovalTimelineService

router = APIRouter(prefix="/audit", tags=["audit"])


def get_timeline_service(db: Session = Depends(get_db)) -> ApprovalTimelineService:
    return ApprovalTimelineService(db)


def require_entity_timeline_view(
    entity_type: str,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """User timelines: ``users.view`` or ``approval.view``; others: ``approval.view`` only."""
    try:
        user_id = int(current.subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        ) from exc
    snapshot = _get_cached_permission_snapshot(db, user_id)
    et = entity_type.strip().lower()
    allowed = (
        _has_any_permission(snapshot, ("users.view", "approval.view"))
        if et in ("user", "user_creation")
        else _has_permissions(snapshot, ("approval.view",))
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
    return current


@router.get("/entity/{entity_type}/{entity_id}")
def entity_timeline(
    entity_type: str,
    entity_id: int,
    current: Annotated[CurrentUser, Depends(require_entity_timeline_view)],
    svc: Annotated[ApprovalTimelineService, Depends(get_timeline_service)],
) -> list[dict[str, Any]]:
    try:
        return svc.get_entity_timeline(
            path_entity_type=entity_type,
            entity_id=entity_id,
            viewer_id=int(current.subject),
        )
    except ApprovalError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
