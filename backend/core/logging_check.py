"""Self-check for technical logging setup.

Run: PYTHONPATH=backend python -m core.logging_check
"""

from __future__ import annotations

import json
import logging
import os
from io import StringIO

from core.logging_setup import ContextFilter, JsonFormatter, configure_logging
from core.request_context import clear_request_context, get_request_id, set_request_id, set_user_id


def main() -> None:
    # Reset configure flag so the check can call configure_logging in isolation.
    import core.logging_setup as ls

    ls._CONFIGURED = False
    os.environ["LOG_FORMAT"] = "json"
    os.environ["LOG_LEVEL"] = "INFO"
    os.environ.pop("LOG_FILE", None)

    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(ContextFilter())
    log = logging.getLogger("core.logging_check")
    log.handlers.clear()
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False

    set_request_id("abc123")
    set_user_id(42)
    assert get_request_id() == "abc123"
    log.info("probe", extra={"event": "probe", "path": "/login"})
    clear_request_context()
    assert get_request_id() == "-"

    line = buf.getvalue().strip().splitlines()[-1]
    payload = json.loads(line)
    assert payload["request_id"] == "abc123"
    assert payload["user_id"] == "42"
    assert payload["event"] == "probe"
    assert payload["message"] == "probe"
    assert payload["level"] == "INFO"

    ls._CONFIGURED = False
    configure_logging()
    assert ls._CONFIGURED is True
    configure_logging()  # idempotent
    assert ls._CONFIGURED is True

    print("ok")


if __name__ == "__main__":
    main()
