"""Structured technical log events (stable ``event`` key for grep / collectors)."""

from __future__ import annotations

import logging
from typing import Any


def log_event(
    logger: logging.Logger,
    event: str,
    *,
    level: int = logging.INFO,
    **fields: Any,
) -> None:
    """Emit one structured line: message == event, plus ``extra`` fields."""
    extra: dict[str, Any] = {"event": event}
    for key, value in fields.items():
        if value is None:
            continue
        extra[key] = value
    logger.log(level, event, extra=extra)
