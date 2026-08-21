"""Login page background image (admin-uploadable branding)."""

from __future__ import annotations

import base64
import json
from typing import Any

from modules.platform.settings.lookup import clear_setting_cache, get_setting

SETTING_KEY = "branding.login_background"


class InvalidLoginBackgroundError(Exception):
    pass


def validate_login_background(data: bytes) -> str:
    if not data:
        raise InvalidLoginBackgroundError("Select an image to upload.")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise InvalidLoginBackgroundError("Only PNG, JPEG, and WebP images are supported.")


def _parse_payload(raw: str | None) -> dict[str, Any] | None:
    if not raw or not raw.strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    b64 = data.get("data_b64")
    ctype = data.get("content_type")
    if not isinstance(b64, str) or not b64.strip():
        return None
    if not isinstance(ctype, str) or not ctype.strip():
        return None
    return {"data_b64": b64.strip(), "content_type": ctype.strip()}


def get_login_background_bytes() -> tuple[bytes, str] | None:
    """Return (bytes, content_type) or None when unset/invalid."""
    payload = _parse_payload(get_setting(SETTING_KEY))
    if payload is None:
        return None
    try:
        raw = base64.b64decode(payload["data_b64"], validate=True)
    except Exception:
        return None
    if not raw:
        return None
    return raw, str(payload["content_type"])


def login_background_configured() -> bool:
    return get_login_background_bytes() is not None


def encode_login_background(data: bytes, content_type: str) -> str:
    return json.dumps(
        {
            "content_type": content_type,
            "data_b64": base64.b64encode(data).decode("ascii"),
        },
        separators=(",", ":"),
    )


def clear_login_background_cache() -> None:
    clear_setting_cache(SETTING_KEY)


# ponytail: assert-based self-check
if __name__ == "__main__":
    try:
        validate_login_background(b"")
        raise SystemExit("expected empty fail")
    except InvalidLoginBackgroundError:
        pass
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    assert validate_login_background(png) == "image/png"
    print("ok")
