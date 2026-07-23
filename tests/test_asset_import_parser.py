from modules.assets.import_parser import _map_headers


def test_map_headers_accepts_template_required_marker() -> None:
    headers = [
        "Asset name *",
        "Asset code *",
        "Asset category *",
        "Plant Code *",
        "Plant Name",
        "Cost Center Code *",
        "Cost Center Name",
        "Profit center *",
        "Actual Location 1",
        "Actual location 2",
        "CapEx form number",
        "RFID code",
    ]
    mapped = _map_headers(headers)
    assert mapped[0] == "asset_name"
    assert mapped[1] == "asset_code"
    assert mapped[2] == "category_code"
    assert mapped[3] == "plant_code"
    assert mapped[4] == "plant_name"
    assert mapped[5] == "cost_center"
    assert mapped[6] == "cost_center_name"
    assert mapped[7] == "profit_center"
    assert mapped[8] == "functional_location"
    assert mapped[9] == "actual_location"
    assert mapped[10] == "capitalization_form_number"
    assert mapped[11] == "rfid_code"


def test_map_headers_accepts_legacy_cost_center_label() -> None:
    mapped = _map_headers(["Cost center *", "Capex form no"])
    assert mapped[0] == "cost_center"
    assert mapped[1] == "capitalization_form_number"


def test_parse_upload_file_skips_blank_rows() -> None:
    from modules.assets.import_parser import is_blank_import_row, parse_upload_file

    assert is_blank_import_row({}) is True
    assert is_blank_import_row({"asset_name": "", "asset_code": "  "}) is True
    assert is_blank_import_row({"asset_name": "Pump"}) is False

    csv_content = (
        "Asset name *,Asset code *,Asset category *,Plant Code *,"
        "Cost Center Code *,Profit center *,Actual Location 1,Actual location 2\n"
        "Pump A,P-001,EQUIPMENT,Takeda,Production cost center,Plant production profit center,"
        "Production line A — Building A,Building A floor 2 room 201\n"
        ",,,,,,,\n"
        "  ,  ,  ,  ,  ,  ,  ,  \n"
    ).encode("utf-8")
    rows = parse_upload_file(filename="assets.csv", content=csv_content)
    assert len(rows) == 1
    assert rows[0].data.get("asset_name") == "Pump A"
