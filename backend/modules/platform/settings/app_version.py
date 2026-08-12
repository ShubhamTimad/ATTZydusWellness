"""Application version shown on the login screen."""

from __future__ import annotations

from modules.platform.settings.lookup import get_setting

SETTING_KEY = "app.version"
DEFAULT_VERSION = "1.0.0"


def get_app_version() -> str:
    raw = get_setting(SETTING_KEY)
    if raw is None:
        return DEFAULT_VERSION
    cleaned = str(raw).strip()
    return cleaned or DEFAULT_VERSION


if __name__ == "__main__":
    assert DEFAULT_VERSION
    print("app_version ok")
