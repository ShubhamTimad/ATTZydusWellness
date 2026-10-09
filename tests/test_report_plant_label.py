"""Report Plant column shows plant name together with plant code."""

from __future__ import annotations

from modules.reports.export import plant_label


def test_plant_label_name_and_code() -> None:
    assert plant_label("ZYDUS_TAKEDA", "1001") == "ZYDUS_TAKEDA (1001)"


def test_plant_label_missing_parts() -> None:
    assert plant_label("ZYDUS_TAKEDA", None) == "ZYDUS_TAKEDA"
    assert plant_label(None, "1001") == "1001"
    assert plant_label(" ", "") == ""
