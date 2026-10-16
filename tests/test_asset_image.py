"""Asset images are bounded and validated by file signature."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import db.models  # noqa: E402,F401
from modules.assets.model import AssetMaster  # noqa: E402
from modules.assets.service import (  # noqa: E402
    MAX_ASSET_IMAGE_BYTES,
    InvalidAssetImageError,
    validate_asset_image,
)


def test_asset_image_columns_exist() -> None:
    columns = AssetMaster.__table__.c
    assert columns.image_data.nullable
    assert columns.image_content_type.type.length == 32
    assert columns.image_filename.type.length == 255
    assert AssetMaster.image_data.property.deferred


def test_supported_image_signatures() -> None:
    assert validate_asset_image(b"\x89PNG\r\n\x1a\npayload") == "image/png"
    assert validate_asset_image(b"\xff\xd8\xffpayload") == "image/jpeg"
    assert validate_asset_image(b"RIFF\x04\x00\x00\x00WEBPpayload") == "image/webp"


def test_invalid_and_oversized_images_are_rejected() -> None:
    for content in (b"not an image", b"\x89PNG\r\n\x1a\n" + b"x" * MAX_ASSET_IMAGE_BYTES):
        try:
            validate_asset_image(content)
        except InvalidAssetImageError:
            pass
        else:
            raise AssertionError("invalid image must be rejected")


if __name__ == "__main__":
    test_asset_image_columns_exist()
    test_supported_image_signatures()
    test_invalid_and_oversized_images_are_rejected()
    print("ok")
