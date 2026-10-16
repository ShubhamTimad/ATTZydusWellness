"""OIDC SSO configuration from settings table with env fallback."""

from __future__ import annotations

import os
from dataclasses import dataclass

from core.mfa_crypto import reveal_stored_secret
from modules.platform.settings.lookup import get_setting
from modules.platform.settings.schema import SsoSettingsPublic

DEFAULT_SCOPES = "openid profile email"
DEFAULT_BUTTON_LABEL = "Sign in with SSO"
DEFAULT_EMAIL_CLAIM = "email"
DEFAULT_SUBJECT_CLAIM = "sub"


def _truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _setting_or_env(key: str, env_key: str, default: str = "") -> str:
    raw = get_setting(key)
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    return (os.environ.get(env_key) or default).strip()


def normalize_issuer(issuer: str) -> str:
    """Trim trailing slash so discovery URLs stay consistent."""
    return (issuer or "").strip().rstrip("/")


@dataclass(frozen=True)
class SsoConfig:
    enabled: bool
    button_label: str
    issuer: str
    client_id: str
    client_secret: str | None
    redirect_uri: str
    scopes: str
    email_claim: str
    subject_claim: str
    allow_jit: bool

    @property
    def discovery_url(self) -> str:
        return f"{self.issuer}/.well-known/openid-configuration"


def is_sso_enabled() -> bool:
    raw = get_setting("sso.enabled")
    if raw is not None and str(raw).strip():
        return _truthy(str(raw))
    return _truthy(os.environ.get("SSO_ENABLED"))


def get_sso_config() -> SsoConfig | None:
    """Runtime config when SSO is enabled; None if disabled or incomplete."""
    if not is_sso_enabled():
        return None
    issuer = normalize_issuer(_setting_or_env("sso.issuer", "SSO_ISSUER"))
    client_id = _setting_or_env("sso.client_id", "SSO_CLIENT_ID")
    redirect_uri = _setting_or_env("sso.redirect_uri", "SSO_REDIRECT_URI")
    secret = reveal_stored_secret(_setting_or_env("sso.client_secret", "SSO_CLIENT_SECRET")) or None
    if not issuer or not client_id or not redirect_uri or not secret:
        return None
    return SsoConfig(
        enabled=True,
        button_label=_setting_or_env("sso.button_label", "SSO_BUTTON_LABEL", DEFAULT_BUTTON_LABEL)
        or DEFAULT_BUTTON_LABEL,
        issuer=issuer,
        client_id=client_id,
        client_secret=secret,
        redirect_uri=redirect_uri,
        scopes=_setting_or_env("sso.scopes", "SSO_SCOPES", DEFAULT_SCOPES) or DEFAULT_SCOPES,
        email_claim=_setting_or_env("sso.email_claim", "SSO_EMAIL_CLAIM", DEFAULT_EMAIL_CLAIM)
        or DEFAULT_EMAIL_CLAIM,
        subject_claim=_setting_or_env("sso.subject_claim", "SSO_SUBJECT_CLAIM", DEFAULT_SUBJECT_CLAIM)
        or DEFAULT_SUBJECT_CLAIM,
        allow_jit=_truthy(_setting_or_env("sso.allow_jit", "SSO_ALLOW_JIT", "false")),
    )


def resolve_sso_config_error(
    payload: SsoSettingsPublic,
    *,
    secret_configured: bool,
) -> str | None:
    """Return a user-facing error when enabling incomplete SSO config."""
    if not payload.enabled:
        return None
    if not normalize_issuer(payload.issuer):
        return "OIDC issuer is required when SSO is enabled."
    if not payload.client_id.strip():
        return "Client ID is required when SSO is enabled."
    if not payload.redirect_uri.strip():
        return "Redirect URI is required when SSO is enabled."
    if not (payload.client_secret.strip() or secret_configured):
        return "Client secret is required when SSO is enabled."
    if not payload.email_claim.strip():
        return "Email claim cannot be empty."
    if not payload.subject_claim.strip():
        return "Subject claim cannot be empty."
    return None


if __name__ == "__main__":
    # ponytail: tiny self-check for validation / issuer normalize (no IdP round-trip).
    assert normalize_issuer(" https://example.com/v2.0/ ") == "https://example.com/v2.0"
    empty = SsoSettingsPublic(enabled=True)
    assert resolve_sso_config_error(empty, secret_configured=False)
    ok = SsoSettingsPublic(
        enabled=True,
        issuer="https://login.microsoftonline.com/tenant/v2.0",
        client_id="cid",
        client_secret="sec",
        redirect_uri="https://app.example/api/auth/sso/callback",
    )
    assert resolve_sso_config_error(ok, secret_configured=False) is None
    print("sso_config ok")
