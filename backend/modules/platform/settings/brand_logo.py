"""Application logo (admin-uploadable branding). Falls back to the shipped logo when unset."""

from __future__ import annotations

import base64
import hashlib
import json
import threading
from io import BytesIO
from typing import Any, Final

from PIL import Image, ImageOps, UnidentifiedImageError

from modules.platform.settings.lookup import clear_setting_cache, get_setting

SETTING_KEY = "branding.logo"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_EDGE_PX = 512

_lock: Final[threading.Lock] = threading.Lock()
_served: tuple[bytes, str, str] | None = None
_served_ready = False


class InvalidBrandLogoError(Exception):
    pass


def validate_brand_logo(data: bytes) -> str:
    if not data:
        raise InvalidBrandLogoError("Select an image to upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidBrandLogoError("Image must be 5 MB or smaller.")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise InvalidBrandLogoError("Only PNG, JPEG, and WebP images are supported.")


def version_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def prepare_brand_logo(data: bytes) -> tuple[bytes, str]:
    """Resize and keep transparency so a PNG logo does not pick up a box."""
    validate_brand_logo(data)
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidBrandLogoError("Could not read that image.") from exc
    img = ImageOps.exif_transpose(img) or img
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha else "RGB")
    img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.Resampling.LANCZOS)
    out = BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue(), "image/png"


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
    return {
        "data_b64": b64.strip(),
        "content_type": ctype.strip(),
        "version": data.get("version") if isinstance(data.get("version"), str) else None,
    }


def _load_served() -> tuple[bytes, str, str] | None:
    payload = _parse_payload(get_setting(SETTING_KEY))
    if payload is None:
        return None
    try:
        raw = base64.b64decode(payload["data_b64"], validate=True)
    except Exception:
        return None
    if not raw:
        return None
    ver = payload["version"] or version_for(raw)
    return raw, str(payload["content_type"]), ver


def get_brand_logo_served() -> tuple[bytes, str, str] | None:
    """Return (bytes, content_type, version) or None when unset."""
    global _served, _served_ready
    with _lock:
        if _served_ready and _served is not None:
            return _served
        served = _load_served()
        _served = served
        _served_ready = served is not None
        return served


def get_brand_logo_bytes() -> tuple[bytes, str] | None:
    served = get_brand_logo_served()
    if served is None:
        return None
    return served[0], served[1]


def encode_brand_logo(data: bytes, content_type: str) -> str:
    return json.dumps(
        {
            "content_type": content_type,
            "data_b64": base64.b64encode(data).decode("ascii"),
            "version": version_for(data),
        },
        separators=(",", ":"),
    )


def clear_brand_logo_cache() -> None:
    global _served, _served_ready
    with _lock:
        _served = None
        _served_ready = False
    clear_setting_cache(SETTING_KEY)


# ponytail: assert-based self-check
if __name__ == "__main__":
    try:
        validate_brand_logo(b"")
        raise SystemExit("expected empty fail")
    except InvalidBrandLogoError:
        pass
    img = Image.new("RGBA", (800, 200), (225, 36, 42, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")
    out, ctype = prepare_brand_logo(buf.getvalue())
    assert ctype == "image/png"
    check = Image.open(BytesIO(out))
    assert max(check.size) <= MAX_EDGE_PX
    print("ok")
