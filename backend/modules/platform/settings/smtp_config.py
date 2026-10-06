"""SMTP / email delivery configuration from settings table with env fallback."""

from __future__ import annotations

import os
from dataclasses import dataclass

from core.mfa_crypto import reveal_stored_secret
from modules.platform.settings.lookup import get_setting
from modules.platform.settings.schema import EmailDeliveryPublic


def _truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def normalize_smtp_host(host: str) -> str:
    """Fix common typos and trim whitespace."""
    h = (host or "").strip()
    if not h:
        return h
    lower = h.lower()
    # Gmail: smtp.google.com does not accept mail and often hangs until TCP timeout.
    if lower == "smtp.google.com":
        return "smtp.gmail.com"
    return h


def _setting_or_env(key: str, env_key: str, default: str = "") -> str:
    raw = get_setting(key)
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    return (os.environ.get(env_key) or default).strip()


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    username: str | None
    password: str | None
    use_tls: bool
    from_email: str
    from_name: str


def is_email_delivery_enabled() -> bool:
    raw = get_setting("email.delivery_enabled")
    if raw is not None and str(raw).strip():
        return _truthy(raw)
    # When unset, enable delivery if SMTP host is configured (settings or env).
    return bool(_setting_or_env("smtp.host", "SMTP_HOST"))


def get_smtp_config() -> SmtpConfig | None:
    if not is_email_delivery_enabled():
        return None

    host = normalize_smtp_host(_setting_or_env("smtp.host", "SMTP_HOST"))
    if not host:
        return None

    port_raw = _setting_or_env("smtp.port", "SMTP_PORT", "587")
    try:
        port = int(port_raw or "587")
    except ValueError:
        port = 587

    user = _setting_or_env("smtp.username", "SMTP_USERNAME") or None
    password = reveal_stored_secret(_setting_or_env("smtp.password", "SMTP_PASSWORD")) or None
    use_tls = _truthy(_setting_or_env("smtp.use_tls", "SMTP_USE_TLS", "true"))
    from_email = _setting_or_env("smtp.from_email", "SMTP_FROM_EMAIL") or (user or "")
    from_name = _setting_or_env("smtp.from_name", "SMTP_FROM_NAME")

    if not from_email:
        return None

    return SmtpConfig(
        host=host,
        port=port,
        username=user,
        password=password,
        use_tls=use_tls,
        from_email=from_email,
        from_name=from_name,
    )


def smtp_config_from_public(
    payload: EmailDeliveryPublic,
    *,
    stored_password: str | None = None,
) -> SmtpConfig | None:
    """Build SMTP config from API payload (e.g. unsaved Settings form)."""
    if not payload.delivery_enabled:
        return None

    host = normalize_smtp_host(payload.smtp_host)
    if not host:
        return None

    from_email = payload.smtp_from_email.strip() or payload.smtp_username.strip()
    if not from_email:
        return None

    password = payload.smtp_password.strip() or (stored_password or "").strip() or None
    user = payload.smtp_username.strip() or None

    return SmtpConfig(
        host=host,
        port=payload.smtp_port,
        username=user,
        password=password,
        use_tls=payload.smtp_use_tls,
        from_email=from_email,
        from_name=payload.smtp_from_name.strip(),
    )


def resolve_smtp_config_error(payload: EmailDeliveryPublic) -> str | None:
    """Human-readable reason when config cannot send mail; None if looks complete."""
    if not payload.delivery_enabled:
        return "Enable “Send real emails”."
    if not normalize_smtp_host(payload.smtp_host):
        return "SMTP host is required."
    if not (payload.smtp_from_email.strip() or payload.smtp_username.strip()):
        return "From email (or username) is required."
    if payload.smtp_username.strip() and not (
        payload.smtp_password.strip() or payload.password_configured
    ):
        return "App password is required for SMTP authentication."
    return None
