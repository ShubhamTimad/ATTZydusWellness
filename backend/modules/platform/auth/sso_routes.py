"""OIDC SSO start + callback routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from db.session import get_db
from modules.platform.auth.sso_oidc import (
    SsoNotConfiguredError,
    SsoPortalMismatchError,
    SsoProtocolError,
    SsoUserNotAuthorizedError,
    build_authorize_redirect,
    complete_sso_callback,
    frontend_sso_error_url,
    frontend_sso_success_url,
    portal_from_state,
)

router = APIRouter(prefix="/auth/sso", tags=["auth", "sso"])


@router.get("/login")
def sso_login(
    portal: Annotated[str, Query(description="user | admin")] = "user",
) -> RedirectResponse:
    try:
        url = build_authorize_redirect(portal=portal if portal in ("user", "admin") else "user")
    except SsoNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SSO is not enabled or is incomplete. Configure it in Settings.",
        ) from exc
    except SsoProtocolError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.get("/callback")
def sso_callback(
    db: Annotated[Session, Depends(get_db)],
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
    error_description: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    portal = portal_from_state(state)

    if error:
        msg = (error_description or error or "SSO sign-in was cancelled.").strip()
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error=msg[:200]),
            status_code=status.HTTP_302_FOUND,
        )

    if not code or not state:
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error="Missing SSO authorization code."),
            status_code=status.HTTP_302_FOUND,
        )

    try:
        tokens, portal = complete_sso_callback(db, code=code, state=state)
    except SsoNotConfiguredError:
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error="SSO is not configured."),
            status_code=status.HTTP_302_FOUND,
        )
    except SsoUserNotAuthorizedError:
        return RedirectResponse(
            url=frontend_sso_error_url(
                portal=portal,
                error="Your account is not authorized for this application. Contact an administrator.",
            ),
            status_code=status.HTTP_302_FOUND,
        )
    except SsoPortalMismatchError as exc:
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error=str(exc)),
            status_code=status.HTTP_302_FOUND,
        )
    except SsoProtocolError as exc:
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error=str(exc)[:220]),
            status_code=status.HTTP_302_FOUND,
        )
    except Exception as exc:
        import logging

        logging.getLogger(__name__).exception("SSO callback failed")
        return RedirectResponse(
            url=frontend_sso_error_url(
                portal=portal,
                error=f"SSO sign-in failed: {type(exc).__name__}: {exc}"[:220],
            ),
            status_code=status.HTTP_302_FOUND,
        )

    return RedirectResponse(
        url=frontend_sso_success_url(portal=portal, tokens=tokens),
        status_code=status.HTTP_302_FOUND,
    )
