"""OIDC SSO start + callback routes."""

from __future__ import annotations

import logging
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
    frontend_sso_silent_miss_url,
    frontend_sso_success_url,
    is_silent_miss_error,
    portal_from_state,
    state_was_silent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/sso", tags=["auth", "sso"])


@router.get("/login")
def sso_login(
    portal: Annotated[str, Query(description="user | admin")] = "user",
    prompt: Annotated[
        str | None,
        Query(description="OIDC prompt; use none for silent SSO"),
    ] = None,
) -> RedirectResponse:
    portal_norm = portal if portal in ("user", "admin") else "user"
    prompt_norm = (prompt or "").strip().lower() or None
    try:
        url = build_authorize_redirect(portal=portal_norm, prompt=prompt_norm)
    except SsoNotConfiguredError as exc:
        logger.warning(
            "sso_login_blocked",
            extra={"event": "sso_login_blocked", "reason": "not_configured", "portal": portal_norm},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SSO is not enabled or is incomplete. Configure it in Settings.",
        ) from exc
    except SsoProtocolError as exc:
        logger.warning(
            "sso_login_blocked",
            extra={
                "event": "sso_login_blocked",
                "reason": "protocol",
                "portal": portal_norm,
                "detail": str(exc)[:180],
            },
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    logger.info(
        "sso_login_started",
        extra={
            "event": "sso_login_started",
            "portal": portal_norm,
            "prompt": prompt_norm or "default",
        },
    )
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
        # Silent prompt=none missed (no Entra session) → ATT login form, no interactive retry.
        if state_was_silent(state) and is_silent_miss_error(error):
            logger.info(
                "sso_silent_miss",
                extra={
                    "event": "sso_silent_miss",
                    "portal": portal,
                    "idp_error": (error or "")[:80],
                },
            )
            return RedirectResponse(
                url=frontend_sso_silent_miss_url(portal=portal),
                status_code=status.HTTP_302_FOUND,
            )
        msg = (error_description or error or "SSO sign-in was cancelled.").strip()
        logger.warning(
            "sso_callback_idp_error",
            extra={"event": "sso_callback_idp_error", "portal": portal, "idp_error": (error or "")[:80]},
        )
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error=msg[:200]),
            status_code=status.HTTP_302_FOUND,
        )

    if not code or not state:
        logger.warning(
            "sso_callback_failed",
            extra={"event": "sso_callback_failed", "reason": "missing_code_or_state", "portal": portal},
        )
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error="Missing SSO authorization code."),
            status_code=status.HTTP_302_FOUND,
        )

    try:
        tokens, portal = complete_sso_callback(db, code=code, state=state)
    except SsoNotConfiguredError:
        logger.warning(
            "sso_callback_failed",
            extra={"event": "sso_callback_failed", "reason": "not_configured", "portal": portal},
        )
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error="SSO is not configured."),
            status_code=status.HTTP_302_FOUND,
        )
    except SsoUserNotAuthorizedError:
        logger.warning(
            "sso_callback_failed",
            extra={"event": "sso_callback_failed", "reason": "not_authorized", "portal": portal},
        )
        return RedirectResponse(
            url=frontend_sso_error_url(
                portal=portal,
                error="Your account is not authorized for this application. Contact an administrator.",
            ),
            status_code=status.HTTP_302_FOUND,
        )
    except SsoPortalMismatchError as exc:
        logger.warning(
            "sso_callback_failed",
            extra={
                "event": "sso_callback_failed",
                "reason": "portal_mismatch",
                "portal": portal,
                "detail": str(exc)[:180],
            },
        )
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error=str(exc)),
            status_code=status.HTTP_302_FOUND,
        )
    except SsoProtocolError as exc:
        logger.warning(
            "sso_callback_failed",
            extra={
                "event": "sso_callback_failed",
                "reason": "protocol",
                "portal": portal,
                "detail": str(exc)[:180],
            },
        )
        return RedirectResponse(
            url=frontend_sso_error_url(portal=portal, error=str(exc)[:220]),
            status_code=status.HTTP_302_FOUND,
        )
    except Exception as exc:
        logger.exception(
            "sso_callback_failed",
            extra={
                "event": "sso_callback_failed",
                "reason": "unexpected",
                "portal": portal,
                "error_type": type(exc).__name__,
            },
        )
        return RedirectResponse(
            url=frontend_sso_error_url(
                portal=portal,
                error=f"SSO sign-in failed: {type(exc).__name__}: {exc}"[:220],
            ),
            status_code=status.HTTP_302_FOUND,
        )

    logger.info("sso_callback_ok", extra={"event": "sso_callback_ok", "portal": portal})
    return RedirectResponse(
        url=frontend_sso_success_url(portal=portal, tokens=tokens),
        status_code=status.HTTP_302_FOUND,
    )
