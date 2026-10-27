"""Symmetric tag code encryption and decryption for QR codes and barcodes.

Encrypts the asset's Combined Asset Number (or asset code) directly using
AES-128-CTR with Base64URL encoding so that:
1. The original code is encrypted and not visible inside the QR or Barcode.
2. The encrypted string has NO block-padding bloat (exact proportional length).
3. The resulting barcode is compact, sharp, and fits neatly on physical tags.
4. Scanning the tag decrypts it directly back to the original Combined Asset Number.
"""

from __future__ import annotations

import base64
import hashlib
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

TAG_CODE_PREFIX = "ZT:"
_DEFAULT_KEY = "9a7c3b8e1f4d2a6e0c5b7f9d1a3e5c7b9a7c3b8e1f4d2a6e0c5b7f9d1a3e5c7b"
_NONCE = b"ZYDUS_TAG_NONCE_"  # 16 bytes


def get_tag_crypto_key() -> str:
    raw = os.environ.get("SECRET_KEY") or os.environ.get("JWT_SECRET_KEY") or _DEFAULT_KEY
    return raw.strip()


def _get_key_bytes() -> bytes:
    return hashlib.sha256(get_tag_crypto_key().encode("utf-8")).digest()[:16]


def encrypt_tag_code(plain_text: str | None, asset_id: int | None = None) -> str:
    """Encrypt a plaintext asset code or combined asset number directly into a compact tag code.

    Example: '123-60000012' -> 'ZT:EHrW1O_96WzgALqN' (only 19 chars).
    Does NOT use asset_id.
    """
    if not plain_text or not plain_text.strip():
        return ""
    val = plain_text.strip()
    key = _get_key_bytes()
    cipher = Cipher(algorithms.AES(key), modes.CTR(_NONCE))
    encryptor = cipher.encryptor()
    ct = encryptor.update(val.encode("utf-8")) + encryptor.finalize()
    b64 = base64.urlsafe_b64encode(ct).decode("ascii").rstrip("=")
    return f"{TAG_CODE_PREFIX}{b64}"


def decrypt_tag_code(encrypted_code: str | None) -> str:
    """Decrypt an encrypted tag code back to the original plaintext code."""
    if not encrypted_code or not encrypted_code.strip():
        return ""
    val = encrypted_code.strip()
    if val.upper().startswith(TAG_CODE_PREFIX.upper()):
        val = val[len(TAG_CODE_PREFIX) :]
    elif val.upper().startswith("ZT-"):
        val = val[3:]
    rem = len(val) % 4
    if rem:
        val += "=" * (4 - rem)
    try:
        ct = base64.urlsafe_b64decode(val)
        key = _get_key_bytes()
        cipher = Cipher(algorithms.AES(key), modes.CTR(_NONCE))
        decryptor = cipher.decryptor()
        pt = decryptor.update(ct) + decryptor.finalize()
        return pt.decode("utf-8").strip()
    except Exception:
        return ""


def resolve_scanned_code(scanned: str | None) -> list[str]:
    """Given a scanned value, returns list of candidate values to match against assets.

    If scanned starts with ZT: or ZT-, decrypts it and returns both [decrypted, scanned].
    Otherwise returns [scanned].
    """
    if not scanned or not scanned.strip():
        return []
    raw = scanned.strip()
    candidates = [raw]
    if raw.upper().startswith(TAG_CODE_PREFIX.upper()) or raw.upper().startswith("ZT-"):
        decrypted = decrypt_tag_code(raw)
        if decrypted and decrypted not in candidates:
            candidates.insert(0, decrypted)
    return candidates
