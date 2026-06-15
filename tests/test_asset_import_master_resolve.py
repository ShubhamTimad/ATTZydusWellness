from modules.assets.import_master_resolve import (
    master_import_label,
    norm_import_value,
    plant_import_label,
    _pick_unique_by_code_or_name,
)


class _Row:
    def __init__(self, code: str, name: str) -> None:
        self.code = code
        self.name = name


def test_pick_unique_by_code_or_name_accepts_name() -> None:
    items = [_Row("CC-4100", "Production cost center")]
    row, err = _pick_unique_by_code_or_name(items, "Production cost center", label="cost center")
    assert err is None
    assert row is not None
    assert row.code == "CC-4100"


def test_pick_unique_by_code_or_name_still_accepts_code() -> None:
    items = [_Row("TAKEDA", "Takeda")]
    row, err = _pick_unique_by_code_or_name(items, "TAKEDA", label="plant")
    assert err is None
    assert row is not None
    assert row.name == "Takeda"


def test_master_import_label_prefers_name() -> None:
    assert master_import_label(name="Production cost center", code="CC-4100") == "Production cost center"
    assert plant_import_label(type("Plant", (), {"name": "Takeda", "code": "TAKEDA"})()) == "Takeda"


def test_norm_import_value_is_case_insensitive() -> None:
    assert norm_import_value(" Takeda ") == "takeda"
