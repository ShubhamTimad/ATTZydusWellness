"""Tests for global scanning process settings and tag verification modes."""

from __future__ import annotations

import pytest
from modules.errors import ConflictError
from db.session import SessionLocal
from modules.platform.settings.lookup import clear_setting_cache
from modules.platform.settings.scanning_process import (
    SCANNING_MODES,
    SETTING_KEY,
    get_scanning_process_config,
)
from modules.platform.settings.schema import ScanningProcessUpdateRequest
from modules.platform.settings.service import SettingsService


def test_scanning_process_modes_metadata():
    assert "rfid_only" in SCANNING_MODES
    assert "barcode_only" in SCANNING_MODES
    assert "qr_only" in SCANNING_MODES
    assert "barcode_qr" in SCANNING_MODES
    assert "rfid_barcode" in SCANNING_MODES
    assert "rfid_qr" in SCANNING_MODES
    assert "rfid_barcode_qr" in SCANNING_MODES

    # Check flags
    assert SCANNING_MODES["rfid_only"]["rfid_enabled"] is True
    assert SCANNING_MODES["rfid_only"]["barcode_enabled"] is False
    assert SCANNING_MODES["rfid_only"]["qr_enabled"] is False

    assert SCANNING_MODES["barcode_qr"]["rfid_enabled"] is False
    assert SCANNING_MODES["barcode_qr"]["barcode_enabled"] is True
    assert SCANNING_MODES["barcode_qr"]["qr_enabled"] is True

    assert SCANNING_MODES["rfid_barcode_qr"]["rfid_enabled"] is True
    assert SCANNING_MODES["rfid_barcode_qr"]["barcode_enabled"] is True
    assert SCANNING_MODES["rfid_barcode_qr"]["qr_enabled"] is True


def test_settings_service_get_and_put_scanning_process():
    db = SessionLocal()
    svc = SettingsService(db)
    try:
        # Save barcode_qr
        res = svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="barcode_qr"))
        assert res.process_mode == "barcode_qr"
        assert res.rfid_enabled is False
        assert res.barcode_enabled is True
        assert res.qr_enabled is True

        # Verify get reflects it
        current = svc.get_scanning_process()
        assert current.process_mode == "barcode_qr"
        assert current.barcode_enabled is True

        # Save rfid_only
        res = svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="rfid_only"))
        assert res.process_mode == "rfid_only"
        assert res.rfid_enabled is True
        assert res.barcode_enabled is False

        # Reset to rfid_barcode_qr
        res = svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="rfid_barcode_qr"))
        assert res.process_mode == "rfid_barcode_qr"
        assert res.rfid_enabled is True
        assert res.barcode_enabled is True
        assert res.qr_enabled is True

        # Invalid mode rejected
        with pytest.raises(ConflictError):
            svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="invalid_scanner"))
    finally:
        db.close()


def test_order_asset_validation_respects_scanning_mode():
    from modules.orders.service import PhysicalOrderService
    from modules.assets.model import AssetMaster
    from sqlalchemy import select

    db = SessionLocal()
    svc = SettingsService(db)
    order_svc = PhysicalOrderService(db)
    try:
        # Find approved active asset without RFID
        asset_without_rfid = db.scalar(
            select(AssetMaster).where(
                AssetMaster.approval_status == "approved",
                (AssetMaster.lifecycle_status == None) | (AssetMaster.lifecycle_status == "active"),
                (AssetMaster.rfid_code == None) | (AssetMaster.rfid_code == ""),
            )
        )
        if asset_without_rfid is None:
            pytest.skip("No asset without RFID in current test database.")

        asset_id = int(asset_without_rfid.id)

        # 1. When mode is rfid_only, asset must be flagged in missing_rfid
        svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="rfid_only"))
        res_rfid = order_svc.validate_assets([asset_id])
        missing_ids_rfid = [x.asset_id for x in res_rfid.missing_rfid]
        assert asset_id in missing_ids_rfid
        assert res_rfid.missing_tag_label == "No RFID tag"

        # 2. When mode is barcode_qr (optical), asset has asset_code so it is eligible and NOT in missing_rfid
        svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="barcode_qr"))
        res_qr = order_svc.validate_assets([asset_id])
        missing_ids_qr = [x.asset_id for x in res_qr.missing_rfid]
        assert asset_id not in missing_ids_qr

        # 3. When mode is rfid_barcode_qr (hybrid), asset has asset_code so it is NOT blocked
        svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="rfid_barcode_qr"))
        res_all = order_svc.validate_assets([asset_id])
        missing_ids_all = [x.asset_id for x in res_all.missing_rfid]
        assert asset_id not in missing_ids_all
    finally:
        # Restore default
        svc.put_scanning_process(ScanningProcessUpdateRequest(process_mode="rfid_barcode_qr"))
        db.close()

