"""Encrypt secrets at rest.

New ciphertext uses DATA_ENCRYPTION_KEY when that env var is set, otherwise the
JWT secret. Decrypt tries both so existing MFA secrets keep working after the
env var is added.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from core.config import get_settings


def _key_bytes(raw: str) -> bytes:
    return base64.urlsafe_b64encode(hashlib.sha256(raw.encode("utf-8")).digest())


def _fernets() -> list[Fernet]:
    keys: list[bytes] = []
    dedicated = (os.environ.get("DATA_ENCRYPTION_KEY") or "").strip()
    if dedicated:
        keys.append(_key_bytes(dedicated))
    keys.append(_key_bytes(get_settings().jwt_secret_key))
    return [Fernet(key) for key in keys]


def encrypt_secret(plain: str) -> str:
    return _fernets()[0].encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    last: Exception | None = None
    for fernet in _fernets():
        try:
            return fernet.decrypt(encrypted.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            last = exc
    if last is not None:
        raise last
    raise InvalidToken("No decryption key configured")


def reveal_stored_secret(stored: str) -> str:
    """Decrypt a settings value. Plaintext rows (written before encryption) pass through."""
    text = (stored or "").strip()
    if not text.startswith("gAAAA"):
        return text
    try:
        return decrypt_secret(text)
    except InvalidToken:
        return text
