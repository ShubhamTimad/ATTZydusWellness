"""Global scanning process and tag verification mode configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from modules.platform.settings.lookup import get_setting

SETTING_KEY: Final = "scanning.process_mode"
DEFAULT_MODE: Final = "rfid_barcode_qr"

SCANNING_MODES: Final[dict[str, dict[str, object]]] = {
    "rfid_only": {
        "label": "RFID only",
        "rfid_enabled": True,
        "barcode_enabled": False,
        "qr_enabled": False,
        "description": "Verification via RFID tag readers only.",
    },
    "barcode_only": {
        "label": "Barcode only",
        "rfid_enabled": False,
        "barcode_enabled": True,
        "qr_enabled": False,
        "description": "Verification via 1D optical barcode scanner only.",
    },
    "qr_only": {
        "label": "QR code only",
        "rfid_enabled": False,
        "barcode_enabled": False,
        "qr_enabled": True,
        "description": "Verification via 2D QR code scanner or camera only.",
    },
    "barcode_qr": {
        "label": "QR code + Barcode",
        "rfid_enabled": False,
        "barcode_enabled": True,
        "qr_enabled": True,
        "description": "Verification via optical QR code or Barcode scanner.",
    },
    "rfid_barcode": {
        "label": "RFID + Barcode",
        "rfid_enabled": True,
        "barcode_enabled": True,
        "qr_enabled": False,
        "description": "Verification via RFID handhelds or Barcode scanner.",
    },
    "rfid_qr": {
        "label": "RFID + QR code",
        "rfid_enabled": True,
        "barcode_enabled": False,
        "qr_enabled": True,
        "description": "Verification via RFID handhelds or QR code camera/scanner.",
    },
    "rfid_barcode_qr": {
        "label": "RFID + Barcode + QR code (All)",
        "rfid_enabled": True,
        "barcode_enabled": True,
        "qr_enabled": True,
        "description": "All scanning methods accepted (RFID tag, Barcode, QR Code).",
    },
}


@dataclass(frozen=True)
class ScanningProcessConfig:
    process_mode: str
    label: str
    rfid_enabled: bool
    barcode_enabled: bool
    qr_enabled: bool
    description: str


def get_scanning_process_config() -> ScanningProcessConfig:
    raw = get_setting(SETTING_KEY)
    mode = raw.strip().lower() if raw else DEFAULT_MODE
    if mode not in SCANNING_MODES:
        mode = DEFAULT_MODE
    details = SCANNING_MODES[mode]
    return ScanningProcessConfig(
        process_mode=mode,
        label=str(details["label"]),
        rfid_enabled=bool(details["rfid_enabled"]),
        barcode_enabled=bool(details["barcode_enabled"]),
        qr_enabled=bool(details["qr_enabled"]),
        description=str(details["description"]),
    )
