"""Lazy-loaded setting values with a short-lived in-memory cache."""

from __future__ import annotations

import threading
import time
from typing import Final

from sqlalchemy import select

from db.session import SessionLocal
from modules.platform.settings.model import Setting

# ponytail: per-process TTL cache. Each uvicorn worker has its own copy and only the worker
# that saved a setting clears it, so other workers see changes within TTL_SECONDS.
# Upgrade path: pub/sub invalidation (Postgres LISTEN/NOTIFY) if that delay ever matters.
TTL_SECONDS: Final = 30.0

_lock: Final[threading.RLock] = threading.RLock()
_cache: Final[dict[str, tuple[float, str | None]]] = {}


def get_setting(key: str) -> str | None:
    """
    Return the value for *key* from the database, cached for ``TTL_SECONDS``.

    Missing keys are cached too, so repeated lookups do not hit the database.
    Returns ``None`` if the key is absent or the stored value is null.
    """
    k = key.strip()
    if not k:
        return None

    now = time.monotonic()
    with _lock:
        hit = _cache.get(k)
        if hit is not None and now - hit[0] < TTL_SECONDS:
            return hit[1]

    db = SessionLocal()
    try:
        row = db.scalar(select(Setting).where(Setting.key == k))
    finally:
        db.close()

    value = row.value if row is not None else None
    with _lock:
        _cache[k] = (now, value)
    return value


def clear_setting_cache(*keys: str) -> None:
    """
    Drop cached values so the next :func:`get_setting` reloads from the database.

    With no *keys*, clears the entire cache.
    """
    with _lock:
        if not keys:
            _cache.clear()
            return
        for raw in keys:
            _cache.pop(raw.strip(), None)
