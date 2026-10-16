"""Application version shown on the login screen, baked into the image at build time (scripts/app-version.sh)."""

from __future__ import annotations

import os


def get_app_version() -> str:
    return (os.environ.get("APP_VERSION") or "").strip() or "dev"


if __name__ == "__main__":
    os.environ["APP_VERSION"] = " 1.0.212 "
    assert get_app_version() == "1.0.212"
    os.environ["APP_VERSION"] = ""
    assert get_app_version() == "dev"
    print("app_version ok")
