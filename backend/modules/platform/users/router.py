from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from core.auth import CurrentUser, get_current_user
from core.permissions import require_any_permission, require_permission, require_superuser
from core.password_policy import PasswordPolicyError
from db.session import get_db
from modules.assets.service import MAX_ASSET_IMAGE_BYTES, InvalidAssetImageError
from modules.errors import ConflictError, NotFoundError, RbacSafetyError
from modules.platform.users.model import User
from modules.platform.users.schema import (
    UserAssigneeListResponse,
    UserCreate,
    UserDetailPublic,
    UserFilterOptions,
    UserListPage,
    UserPublic,
    UserSubmitForApprovalRequest,
    UserSubmitForApprovalResponse,
    UserUpdate,
)
from modules.platform.users.service import DuplicateEmailError, DuplicatePhoneError, DuplicateUsernameError, UserService

router = APIRouter(prefix="/users", tags=["admin", "users"])


def get_user_service(db: Session = Depends(get_db)) -> UserService:
    return UserService(db)


@router.post(
    "",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: UserCreate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.create"))],
) -> User | JSONResponse:
    try:
        return svc.create_user(payload, actor_user_id=int(current.subject))
    except PasswordPolicyError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": exc.error},
        )
    except DuplicateEmailError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered.",
        ) from None
    except DuplicateUsernameError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already registered.",
        ) from None
    except DuplicatePhoneError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone number is already registered.",
        ) from None
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("", response_model=list[UserPublic])
def list_users(
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.view"))],
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None, description="Match name, username, email, or phone"),
    is_active: bool | None = Query(None, description="Filter by active status"),
    is_locked: bool | None = Query(None, description="Filter by account lock"),
    role_id: int | None = Query(None, ge=1, description="Filter by role id"),
) -> list[User]:
    return svc.list_users(
        offset=skip,
        limit=limit,
        search=search,
        is_active=is_active,
        is_locked=is_locked,
        role_id=role_id,
    )


@router.get("/filter-options", response_model=UserFilterOptions)
def user_filter_options(
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.view"))],
) -> UserFilterOptions:
    return UserFilterOptions(**svc.list_user_filter_options())


@router.get("/page", response_model=UserListPage)
def list_users_page(
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.view"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: str | None = Query(None, description="Match name, username, email, or phone"),
    name: str | None = Query(None, description="Match full name, username, or email"),
    phone: str | None = Query(None, description="Match phone"),
    is_active: bool | None = Query(None, description="Filter by active status"),
    is_locked: bool | None = Query(None, description="Filter by account lock"),
    role_id: int | None = Query(None, ge=1, description="Filter by role id"),
    plant: str | None = Query(None, description="Exact plant name"),
    department: str | None = Query(None, description="Exact department name"),
    cost_center: str | None = Query(None, description="Exact cost center code"),
) -> UserListPage:
    items, total = svc.list_users_page(
        page=page,
        page_size=page_size,
        search=search,
        name=name,
        phone=phone,
        is_active=is_active,
        is_locked=is_locked,
        role_id=role_id,
        plant=plant,
        department=department,
        cost_center=cost_center,
    )
    return UserListPage(
        items=[UserPublic.model_validate(u) for u in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/assignees", response_model=UserAssigneeListResponse)
def list_user_creation_assignees_for_create(
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_any_permission("users.create", "users.update"))],
) -> UserAssigneeListResponse:
    """First-step approvers for users.create (create-page Submit picker)."""
    try:
        return svc.list_assignees_for_user_creation(None)
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/{user_id}", response_model=UserDetailPublic)
def get_user(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.view"))],
) -> UserDetailPublic:
    try:
        return svc.get_user_detail(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{user_id}/assignees", response_model=UserAssigneeListResponse)
def list_user_creation_assignees(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_any_permission("users.create", "users.update"))],
) -> UserAssigneeListResponse:
    try:
        return svc.list_assignees_for_user_creation(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/{user_id}/submit-for-approval", response_model=UserSubmitForApprovalResponse)
def submit_user_for_approval(
    user_id: int,
    payload: UserSubmitForApprovalRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_any_permission("users.create", "users.update"))],
) -> UserSubmitForApprovalResponse:
    try:
        result = svc.submit_for_approval(
            user_id,
            actor_user_id=int(current.subject),
            assignee_user_id=payload.assignee_user_id,
        )
        return UserSubmitForApprovalResponse(**result)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> User | JSONResponse:
    try:
        return svc.update_user(user_id, payload, actor_user_id=int(current.subject))
    except PasswordPolicyError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": exc.error},
        )
    except DuplicateEmailError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered.",
        ) from None
    except DuplicateUsernameError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already registered.",
        ) from None
    except DuplicatePhoneError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone number is already registered.",
        ) from None
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/{user_id}/photo")
def get_user_photo(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.view"))],
) -> Response:
    try:
        content, content_type = svc.get_photo(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "private, no-store"})


@router.put("/{user_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
async def upload_user_photo(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_any_permission("users.create", "users.update"))],
    file: UploadFile = File(...),
) -> None:
    try:
        svc.set_photo(user_id, await file.read(MAX_ASSET_IMAGE_BYTES + 1))
    except InvalidAssetImageError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    finally:
        await file.close()


@router.delete("/{user_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_photo(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> None:
    try:
        svc.clear_photo(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{user_id}/unlock")
def unlock_user_account(
    user_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.unlock"))],
) -> dict[str, object]:
    try:
        return svc.unlock_account(user_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{user_id}/resend-mfa",
    status_code=status.HTTP_204_NO_CONTENT,
)
def resend_mfa_setup(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("mfa.manage"))],
) -> None:
    try:
        svc.resend_mfa_setup_email(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{user_id}/resend-welcome",
    status_code=status.HTTP_204_NO_CONTENT,
)
def resend_welcome_email(
    user_id: int,
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> None:
    try:
        svc.resend_welcome_email(user_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/{user_id}/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def assign_role_to_user(
    user_id: int,
    role_id: int,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    svc: Annotated[UserService, Depends(get_user_service)],
    _: Annotated[object, Depends(require_permission("users.update"))],
) -> None:
    try:
        svc.assign_role(user_id, role_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except RbacSafetyError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_user(
    user_id: int,
    current: Annotated[CurrentUser, Depends(require_superuser())],
    svc: Annotated[UserService, Depends(get_user_service)],
) -> Response:
    try:
        svc.delete_user_permanently(user_id, actor_user_id=int(current.subject))
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RbacSafetyError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
