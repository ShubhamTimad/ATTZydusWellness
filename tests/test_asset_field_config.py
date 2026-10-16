"""Asset field config validation."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from modules.assets.field_config_seed import ASSET_FIELD_CONFIG_SEED  # noqa: E402


def test_required_implies_visible_in_seed() -> None:
    for row in ASSET_FIELD_CONFIG_SEED:
        assert not row["is_required"] or row["is_visible"], row["field_key"]


def test_seed_has_unique_field_keys() -> None:
    keys = [row["field_key"] for row in ASSET_FIELD_CONFIG_SEED]
    assert len(keys) == len(set(keys))


if __name__ == "__main__":
    test_required_implies_visible_in_seed()
    test_seed_has_unique_field_keys()
    print("ok")
