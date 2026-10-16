"""OIDC authorization-code SSO (provider-agnostic via discovery)."""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.config import get_settings
from core.request_context import set_user_id
from core.security import hash_password
from modules.platform.auth.schema import TokenPair
from modules.platform.auth.service import AuthService
from modules.platform.settings.sso_config import SsoConfig, get_sso_config
from modules.platform.users.model import User

logger = logging.getLogger(__name__)

_STATE_TYP = "sso_oidc_state"
_HTTP_TIMEOUT = 20.0


class SsoNotConfiguredError(Exception):
    pass


class SsoProtocolError(Exception):
    pass


class SsoUserNotAuthorizedError(Exception):
    """Authenticated at IdP but not allowed into ATT."""


class SsoPortalMismatchError(Exception):
    """User/admin portal does not match account type."""


def _frontend_base() -> str:
    return (
        os.environ.get("FRONTEND_APP_URL")
        or os.environ.get("FRONTEND_ORIGIN")
        or "http://localhost:5173"
    ).rstrip("/")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _pkce_pair() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _sign_state(*, portal: str, code_verifier: str, silent: bool = False) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "typ": _STATE_TYP,
            "portal": portal,
            "cv": code_verifier,
            "silent": bool(silent),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=15)).timestamp()),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _parse_state(state: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(
            state,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise SsoProtocolError("Invalid or expired SSO state.") from exc
    if payload.get("typ") != _STATE_TYP:
        raise SsoProtocolError("Invalid SSO state.")
    portal = payload.get("portal")
    cv = payload.get("cv")
    if portal not in ("user", "admin") or not isinstance(cv, str) or not cv:
        raise SsoProtocolError("Invalid SSO state.")
    return payload


def _fetch_discovery(cfg: SsoConfig) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            res = client.get(cfg.discovery_url)
            res.raise_for_status()
            return res.json()
    except Exception as exc:
        raise SsoProtocolError("Failed to load OIDC discovery document.") from exc


# IdP errors from prompt=none that mean "no session" — show ATT login form (no interactive retry).
_SILENT_MISS_ERRORS = frozenset({"login_required", "interaction_required", "consent_required"})


def authorize_query_params(
    *,
    client_id: str,
    redirect_uri: str,
    scopes: str,
    state: str,
    code_challenge: str,
    prompt: str | None = None,
) -> dict[str, str]:
    """Build OIDC authorize query params (authorization code + PKCE)."""
    params: dict[str, str] = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "response_mode": "query",
    }
    if prompt:
        params["prompt"] = prompt
    return params


def build_authorize_redirect(*, portal: str, prompt: str | None = None) -> str:
    """Start OIDC authorize. Use prompt='none' for silent SSO (existing IdP session).

    Defaults to select_account so the IdP always shows its account picker (or the sign-in
    form when there is no session) instead of silently reusing the browser's session.
    """
    cfg = get_sso_config()
    if cfg is None:
        raise SsoNotConfiguredError
    if portal not in ("user", "admin"):
        portal = "user"
    prompt_norm = (prompt or "").strip().lower() or "select_account"
    if prompt_norm not in ("none", "login", "consent", "select_account"):
        prompt_norm = "select_account"
    silent = prompt_norm == "none"
    discovery = _fetch_discovery(cfg)
    authorize = discovery.get("authorization_endpoint")
    if not authorize:
        raise SsoProtocolError("OIDC discovery missing authorization_endpoint.")
    verifier, challenge = _pkce_pair()
    state = _sign_state(portal=portal, code_verifier=verifier, silent=silent)
    params = authorize_query_params(
        client_id=cfg.client_id,
        redirect_uri=cfg.redirect_uri,
        scopes=cfg.scopes,
        state=state,
        code_challenge=challenge,
        prompt=prompt_norm,
    )
    return f"{authorize}?{urlencode(params)}"


def is_silent_miss_error(error: str | None) -> bool:
    """True when prompt=none failed because there is no usable IdP session."""
    return (error or "").strip().lower() in _SILENT_MISS_ERRORS


def state_was_silent(state: str | None) -> bool:
    if not state:
        return False
    try:
        return bool(_parse_state(state).get("silent"))
    except SsoProtocolError:
        return False


def _exchange_code(cfg: SsoConfig, discovery: dict[str, Any], *, code: str, code_verifier: str) -> dict[str, Any]:
    token_url = discovery.get("token_endpoint")
    if not token_url:
        raise SsoProtocolError("OIDC discovery missing token_endpoint.")
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret or "",
        "code_verifier": code_verifier,
    }
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            res = client.post(token_url, data=data)
            if res.status_code >= 400:
                detail = "Token exchange failed."
                try:
                    body = res.json()
                    desc = body.get("error_description") or body.get("error")
                    if desc:
                        detail = f"Token exchange failed: {str(desc)[:180]}"
                except Exception:
                    pass
                raise SsoProtocolError(detail)
            return res.json()
    except SsoProtocolError:
        raise
    except Exception as exc:
        raise SsoProtocolError("Token exchange failed.") from exc


def _decode_id_token(
    id_token: str,
    *,
    key_data: dict[str, Any],
    audience: str,
    issuer: str | None,
) -> dict[str, Any]:
    """Validate ID token; pass raw JWK dict (python-jose constructs the key)."""
    header = jwt.get_unverified_header(id_token)
    alg = header.get("alg") or key_data.get("alg") or "RS256"
    options: dict[str, Any] = {"verify_at_hash": False}
    kwargs: dict[str, Any] = {
        "algorithms": [alg],
        "audience": audience,
        "options": options,
    }
    if issuer:
        kwargs["issuer"] = issuer
    else:
        options["verify_iss"] = False
    return jwt.decode(id_token, key_data, **kwargs)


def _issuer_matches(token_iss: str, cfg_iss: str) -> bool:
    """Same issuer, allowing only a trailing slash or Entra /v2.0 suffix difference."""
    left = (token_iss or "").rstrip("/")
    right = (cfg_iss or "").rstrip("/")
    if not left or not right:
        return False
    if left == right:
        return True
    suffix = "/v2.0"
    if left.endswith(suffix) and left[: -len(suffix)] == right:
        return True
    if right.endswith(suffix) and right[: -len(suffix)] == left:
        return True
    return False


def _configured_tenant(issuer: str) -> str | None:
    match = re.search(r"login\.microsoftonline\.com/([^/]+)", issuer or "")
    if match is None:
        return None
    tenant = match.group(1)
    if tenant in {"common", "organizations", "consumers"}:
        return None
    return tenant


def _verify_id_token(cfg: SsoConfig, discovery: dict[str, Any], id_token: str) -> dict[str, Any]:
    jwks_uri = discovery.get("jwks_uri")
    if not jwks_uri:
        raise SsoProtocolError("OIDC discovery missing jwks_uri.")
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            jwks = client.get(jwks_uri).json()
    except Exception as exc:
        raise SsoProtocolError("Failed to load IdP signing keys.") from exc

    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise SsoProtocolError("Invalid ID token.") from exc
    kid = header.get("kid")
    keys = jwks.get("keys") or []
    key_data = next((k for k in keys if k.get("kid") == kid), None) if kid else (keys[0] if keys else None)
    if key_data is None:
        raise SsoProtocolError("No matching IdP signing key.")

    try:
        return _decode_id_token(
            id_token,
            key_data=key_data,
            audience=cfg.client_id,
            issuer=cfg.issuer,
        )
    except JWTError as exc:
        try:
            unverified = jwt.get_unverified_claims(id_token)
        except JWTError as exc2:
            raise SsoProtocolError("ID token validation failed.") from exc2
        token_iss = str(unverified.get("iss") or "")
        if _issuer_matches(token_iss, cfg.issuer):
            try:
                return _decode_id_token(
                    id_token,
                    key_data=key_data,
                    audience=cfg.client_id,
                    issuer=token_iss.rstrip("/"),
                )
            except JWTError as exc2:
                raise SsoProtocolError("ID token validation failed.") from exc2
        raise SsoProtocolError("ID token validation failed.") from exc
    except Exception as exc:
        logger.exception("SSO ID token verification failed")
        raise SsoProtocolError(f"ID token validation failed: {exc}") from exc


def _claim_str(claims: dict[str, Any], name: str) -> str | None:
    raw = claims.get(name)
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _email_from_claims(cfg: SsoConfig, claims: dict[str, Any]) -> str | None:
    """Resolve a login email; Entra often uses preferred_username / upn."""
    candidates = [
        cfg.email_claim,
        "email",
        "preferred_username",
        "upn",
        "unique_name",
    ]
    seen: set[str] = set()
    for name in candidates:
        if not name or name in seen:
            continue
        seen.add(name)
        value = _claim_str(claims, name)
        if value and "@" in value:
            return value.lower()
    return None


def _unique_username(db: Session, email: str) -> str:
    local = email.split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9._-]", "", local)[:48] or "user"
    candidate = base[:64]
    n = 0
    while db.scalar(select(User.id).where(User.username == candidate)) is not None:
        n += 1
        suffix = f"-{n}"
        candidate = (base[: 64 - len(suffix)] + suffix)[:64]
    return candidate


def _subject_candidates(cfg: SsoConfig, claims: dict[str, Any]) -> list[str]:
    found: list[str] = []
    for name in (cfg.subject_claim, "oid", "sub"):
        value = _claim_str(claims, name)
        if value and value not in found:
            found.append(value)
    return found


def _tenant_allows_email_link(cfg: SsoConfig, claims: dict[str, Any]) -> bool:
    """Refuse cross-tenant email linking (Entra nOAuth). Non-Entra issuers have no tid pin."""
    expected = _configured_tenant(cfg.issuer)
    if expected is None:
        return True
    return str(claims.get("tid") or "") == expected


def _resolve_or_create_user(db: Session, cfg: SsoConfig, claims: dict[str, Any]) -> User:
    subjects = _subject_candidates(cfg, claims)
    subject = subjects[0] if subjects else None
    email = _email_from_claims(cfg, claims)
    if not subject:
        raise SsoProtocolError("ID token missing subject claim.")
    if not email:
        raise SsoProtocolError(
            "ID token missing a usable email. In Entra: Token configuration → add optional claim "
            "'email', or set Email claim to preferred_username."
        )

    user = db.scalar(
        select(User)
        .where(User.external_subject.in_(subjects))
        .options(selectinload(User.mfa_record), selectinload(User.org_units))
    )
    if user is None and _tenant_allows_email_link(cfg, claims):
        user = db.scalar(
            select(User)
            .where(User.email == email)
            .options(selectinload(User.mfa_record), selectinload(User.org_units))
        )
        if user is not None and not user.external_subject:
            user.external_subject = subject
            db.commit()

    if user is None and not _tenant_allows_email_link(cfg, claims):
        raise SsoUserNotAuthorizedError

    if user is None:
        if not cfg.allow_jit:
            raise SsoUserNotAuthorizedError
        name = (
            _claim_str(claims, "name")
            or _claim_str(claims, "given_name")
            or email.split("@", 1)[0]
        )
        now = datetime.now(timezone.utc)
        user = User(
            full_name=(name or email)[:255],
            username=_unique_username(db, email),
            email=email,
            phone=None,
            external_subject=subject,
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            password_changed_at=now,
            is_active=True,
            is_superuser=False,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    if not user.is_active:
        raise SsoUserNotAuthorizedError
    return user


def complete_sso_callback(
    db: Session,
    *,
    code: str,
    state: str,
) -> tuple[TokenPair, str]:
    """Exchange code, resolve user, issue ATT tokens. Returns (tokens, portal)."""
    cfg = get_sso_config()
    if cfg is None:
        raise SsoNotConfiguredError
    state_payload = _parse_state(state)
    portal = str(state_payload["portal"])
    code_verifier = str(state_payload["cv"])
    discovery = _fetch_discovery(cfg)
    token_payload = _exchange_code(cfg, discovery, code=code, code_verifier=code_verifier)
    id_token = token_payload.get("id_token")
    if not isinstance(id_token, str) or not id_token:
        raise SsoProtocolError("Token response missing id_token.")
    claims = _verify_id_token(cfg, discovery, id_token)
    user = _resolve_or_create_user(db, cfg, claims)

    if portal == "admin" and not user.is_superuser:
        raise SsoPortalMismatchError("Admin SSO requires a superuser account.")
    if portal == "user" and user.is_superuser:
        raise SsoPortalMismatchError("Superadmin accounts must use admin SSO.")
    if user.locked_at is not None:
        from modules.platform.auth.service import AccountLockedError

        raise AccountLockedError

    set_user_id(int(user.id))
    tokens = AuthService(db).issue_token_pair(user, auth_method="sso")
    logger.info(
        "sso_user_resolved",
        extra={"event": "sso_user_resolved", "portal": portal, "user_id": int(user.id)},
    )
    return tokens, portal


def portal_from_state(state: str | None) -> str:
    if not state:
        return "user"
    try:
        return str(_parse_state(state).get("portal") or "user")
    except SsoProtocolError:
        return "user"


def issue_sso_exchange_code(db: Session, tokens: TokenPair, portal: str) -> str:
    from modules.platform.auth.model import SsoExchangeCode

    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.add(
        SsoExchangeCode(
            code_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            portal=portal if portal in ("user", "admin") else "user",
            expires_at=now + timedelta(seconds=60),
        )
    )
    db.commit()
    return raw


def consume_sso_exchange_code(db: Session, code: str) -> tuple[str, str, str] | None:
    from modules.platform.auth.model import SsoExchangeCode

    raw = (code or "").strip()
    if not raw:
        return None
    now = datetime.now(timezone.utc)
    row = db.scalar(
        select(SsoExchangeCode).where(
            SsoExchangeCode.code_hash == hashlib.sha256(raw.encode("utf-8")).hexdigest(),
            SsoExchangeCode.used_at.is_(None),
            SsoExchangeCode.expires_at > now,
        )
    )
    if row is None:
        return None
    row.used_at = now
    db.commit()
    return row.access_token, row.refresh_token, row.portal


def frontend_sso_success_url(*, portal: str, code: str) -> str:
    path = "/sso/callback"
    qs = urlencode({"code": code, "portal": portal})
    return f"{_frontend_base()}{path}?{qs}"


def frontend_sso_error_url(*, portal: str, error: str) -> str:
    login = "/admin/login" if portal == "admin" else "/login"
    return f"{_frontend_base()}{login}?{urlencode({'sso_error': error})}"


def frontend_sso_silent_miss_url(*, portal: str) -> str:
    """Return to login form after silent SSO miss; skips auto prompt=none (non-blocking)."""
    login = "/admin/login" if portal == "admin" else "/login"
    return f"{_frontend_base()}{login}?{urlencode({'sso_skip': '1'})}"


if __name__ == "__main__":
    # ponytail: authorize params + silent-miss classification (no IdP round-trip).
    p = authorize_query_params(
        client_id="cid",
        redirect_uri="https://assets.timadit.com/api/auth/sso/callback",
        scopes="openid profile email",
        state="st",
        code_challenge="ch",
        prompt="none",
    )
    assert p["response_type"] == "code"
    assert p["code_challenge_method"] == "S256"
    assert p["prompt"] == "none"
    assert "id_token" not in p.get("response_type", "")
    assert is_silent_miss_error("login_required")
    assert is_silent_miss_error("interaction_required")
    assert not is_silent_miss_error("access_denied")
    assert "sso_skip=1" in frontend_sso_silent_miss_url(portal="user")
    assert _issuer_matches("https://login.example/v2.0", "https://login.example")
    assert not _issuer_matches(
        "https://login.microsoftonline.com/other/v2.0",
        "https://login.microsoftonline.com/mine/v2.0",
    )
    assert "code=" in frontend_sso_success_url(portal="user", code="abc")
    assert "access_token" not in frontend_sso_success_url(portal="user", code="abc")
    print("sso_oidc ok")
