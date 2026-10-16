"""System-wide session idle timeout (minutes) + SSO apply flag."""

from __future__ import annotations

from modules.platform.settings.lookup import get_setting

SETTING_KEY = "session.idle_timeout_minutes"
SSO_IDLE_ENABLED_KEY = "sso.idle_enabled"
DEFAULT_IDLE_MINUTES = 10
MIN_IDLE_MINUTES = 1
MAX_IDLE_MINUTES = 24 * 60


def _truthy(raw: str | None) -> bool:
    if raw is None:
        return False
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def get_session_idle_timeout_minutes() -> int:
    raw = get_setting(SETTING_KEY)
    if raw is None or not str(raw).strip():
        return DEFAULT_IDLE_MINUTES
    try:
        value = int(str(raw).strip())
    except ValueError:
        return DEFAULT_IDLE_MINUTES
    return max(MIN_IDLE_MINUTES, min(MAX_IDLE_MINUTES, value))


def is_sso_idle_enabled() -> bool:
    """Whether the shared session idle timeout also applies to SSO sessions."""
    raw = get_setting(SSO_IDLE_ENABLED_KEY)
    if raw is None or not str(raw).strip():
        return False
    return _truthy(str(raw))


def idle_policy_for_auth_method(auth_method: str | None) -> tuple[bool, int]:
    """
    Return (idle_enabled, timeout_minutes) for a session.

    Password sessions always use the global idle timeout.
    SSO sessions use the same minutes only when ``sso.idle_enabled`` / apply_to_sso is true.
    """
    method = (auth_method or "password").strip().lower()
    minutes = get_session_idle_timeout_minutes()
    if method == "sso":
        if not is_sso_idle_enabled():
            return False, 0
        return True, minutes
    return True, minutes
