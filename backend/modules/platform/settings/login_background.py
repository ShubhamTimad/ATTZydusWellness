"""Login page background image (admin-uploadable branding)."""

from __future__ import annotations

import base64
import hashlib
import json
import threading
from io import BytesIO
from typing import Any, Final

from PIL import Image, ImageOps, UnidentifiedImageError

from modules.platform.settings.lookup import clear_setting_cache, get_setting

SETTING_KEY = "branding.login_background"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
# Full-bleed login photo; 2560 covers retina 1080p without keeping multi-MB originals.
MAX_EDGE_PX = 2560
JPEG_QUALITY = 80

_lock: Final[threading.Lock] = threading.Lock()
# (bytes, content_type, version) once prepared for this process; None = unset.
_served: tuple[bytes, str, str] | None = None
_served_ready = False


class InvalidLoginBackgroundError(Exception):
    pass


def validate_login_background(data: bytes) -> str:
    if not data:
        raise InvalidLoginBackgroundError("Select an image to upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidLoginBackgroundError("Image must be 20 MB or smaller.")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise InvalidLoginBackgroundError("Only PNG, JPEG, and WebP images are supported.")


def version_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def optimize_login_background(data: bytes) -> tuple[bytes, str]:
    """Resize and re-encode so the login page is not serving multi-megabyte photos."""
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidLoginBackgroundError("Could not read that image.") from exc
    img = ImageOps.exif_transpose(img) or img
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.Resampling.LANCZOS)
    out = BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return out.getvalue(), "image/jpeg"


def prepare_login_background(data: bytes) -> tuple[bytes, str]:
    validate_login_background(data)
    return optimize_login_background(data)


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
        "optimized": data.get("optimized") is True,
        "version": data.get("version") if isinstance(data.get("version"), str) else None,
    }


def _decode_payload(payload: dict[str, Any]) -> tuple[bytes, str] | None:
    try:
        raw = base64.b64decode(payload["data_b64"], validate=True)
    except Exception:
        return None
    if not raw:
        return None
    return raw, str(payload["content_type"])


def _load_served() -> tuple[bytes, str, str] | None:
    payload = _parse_payload(get_setting(SETTING_KEY))
    if payload is None:
        return None
    decoded = _decode_payload(payload)
    if decoded is None:
        return None
    raw, ctype = decoded
    if payload["optimized"]:
        ver = payload["version"] or version_for(raw)
        return raw, ctype, ver
    try:
        raw, ctype = optimize_login_background(raw)
    except InvalidLoginBackgroundError:
        return None
    return raw, ctype, version_for(raw)


def get_login_background_served() -> tuple[bytes, str, str] | None:
    """Return (bytes, content_type, version) of the image we actually send to browsers."""
    global _served, _served_ready
    with _lock:
        if _served_ready:
            return _served
        served = _load_served()
        _served = served
        _served_ready = True
        return served


def get_login_background_bytes() -> tuple[bytes, str] | None:
    """Return (bytes, content_type) or None when unset/invalid."""
    served = get_login_background_served()
    if served is None:
        return None
    return served[0], served[1]


def login_background_configured() -> bool:
    return get_login_background_bytes() is not None


def encode_login_background(data: bytes, content_type: str) -> str:
    return json.dumps(
        {
            "content_type": content_type,
            "data_b64": base64.b64encode(data).decode("ascii"),
            "version": version_for(data),
            "optimized": True,
        },
        separators=(",", ":"),
    )


def clear_login_background_cache() -> None:
    global _served, _served_ready
    with _lock:
        _served = None
        _served_ready = False
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
    # Noise so JPEG is not a tiny solid-color file.
    big = Image.effect_noise((4000, 3000), 48).convert("RGB")
    buf = BytesIO()
    big.save(buf, format="JPEG", quality=95)
    original = buf.getvalue()
    out, ctype = prepare_login_background(original)
    assert ctype == "image/jpeg"
    assert out.startswith(b"\xff\xd8\xff")
    assert len(out) < len(original)
    check = Image.open(BytesIO(out))
    assert max(check.size) <= MAX_EDGE_PX
    a = version_for(out)
    b = version_for(out + b"x")
    assert a != b and len(a) == 16
    print("ok")
