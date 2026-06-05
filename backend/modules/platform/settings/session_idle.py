"""System-wide session idle timeout (minutes)."""

from __future__ import annotations

from modules.platform.settings.lookup import get_setting

SETTING_KEY = "session.idle_timeout_minutes"
DEFAULT_IDLE_MINUTES = 10
MIN_IDLE_MINUTES = 1
MAX_IDLE_MINUTES = 24 * 60


def get_session_idle_timeout_minutes() -> int:
    raw = get_setting(SETTING_KEY)
    if raw is None or not str(raw).strip():
        return DEFAULT_IDLE_MINUTES
    try:
        value = int(str(raw).strip())
    except ValueError:
        return DEFAULT_IDLE_MINUTES
    return max(MIN_IDLE_MINUTES, min(MAX_IDLE_MINUTES, value))
