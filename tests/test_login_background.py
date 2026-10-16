"""Login background is compressed on save and versioned for browser cache."""

from __future__ import annotations

import base64
import json
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from PIL import Image  # noqa: E402

from modules.platform.settings.login_background import (  # noqa: E402
    MAX_EDGE_PX,
    MAX_UPLOAD_BYTES,
    InvalidLoginBackgroundError,
    clear_login_background_cache,
    get_login_background_served,
    prepare_login_background,
    validate_login_background,
    version_for,
)


def _noisy_jpeg(width: int, height: int, quality: int = 95) -> bytes:
    img = Image.effect_noise((width, height), 48).convert("RGB")
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def test_large_photo_is_resized_and_smaller() -> None:
    original = _noisy_jpeg(3000, 2000, quality=30)
    assert len(original) <= MAX_UPLOAD_BYTES
    out, ctype = prepare_login_background(original)
    assert ctype == "image/jpeg"
    assert out.startswith(b"\xff\xd8\xff")
    check = Image.open(BytesIO(out))
    assert max(check.size) <= MAX_EDGE_PX
    assert max(check.size) < max(Image.open(BytesIO(original)).size)


def test_version_changes_when_bytes_change() -> None:
    a = version_for(b"one")
    b = version_for(b"two")
    assert a != b
    assert len(a) == 16
    assert version_for(b"one") == a


def test_rejects_invalid_and_oversized() -> None:
    try:
        validate_login_background(b"not-an-image")
    except InvalidLoginBackgroundError:
        pass
    else:
        raise AssertionError("invalid image must be rejected")
    try:
        validate_login_background(b"\xff\xd8\xff" + b"x" * MAX_UPLOAD_BYTES)
    except InvalidLoginBackgroundError:
        pass
    else:
        raise AssertionError("oversized image must be rejected")


def test_legacy_unoptimized_payload_is_resized_on_serve() -> None:
    original = _noisy_jpeg(3000, 2000)
    payload = json.dumps(
        {
            "content_type": "image/jpeg",
            "data_b64": base64.b64encode(original).decode("ascii"),
        }
    )
    clear_login_background_cache()
    try:
        with patch(
            "modules.platform.settings.login_background.get_setting",
            return_value=payload,
        ):
            served = get_login_background_served()
        assert served is not None
        data, ctype, ver = served
        assert ctype == "image/jpeg"
        assert len(data) < len(original)
        assert max(Image.open(BytesIO(data)).size) <= MAX_EDGE_PX
        assert ver
    finally:
        clear_login_background_cache()


if __name__ == "__main__":
    test_large_photo_is_resized_and_smaller()
    test_version_changes_when_bytes_change()
    test_rejects_invalid_and_oversized()
    test_legacy_unoptimized_payload_is_resized_on_serve()
    print("ok")
