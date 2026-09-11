"""Self-check for technical logging setup.

Run: PYTHONPATH=backend python -m core.logging_check
"""

from __future__ import annotations

import json
import logging
import os
from io import StringIO

from core.app_log import log_event
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
    log_event(log, "helper_probe", order_id=7, order_number="PVO-1")
    clear_request_context()
    assert get_request_id() == "-"

    lines = [json.loads(line) for line in buf.getvalue().strip().splitlines()]
    assert lines[0]["request_id"] == "abc123"
    assert lines[0]["user_id"] == "42"
    assert lines[0]["event"] == "probe"
    assert lines[0]["message"] == "probe"
    assert lines[0]["level"] == "INFO"
    assert lines[1]["event"] == "helper_probe"
    assert lines[1]["message"] == "helper_probe"
    assert lines[1]["order_id"] == 7
    assert lines[1]["order_number"] == "PVO-1"

    ls._CONFIGURED = False
    configure_logging()
    assert ls._CONFIGURED is True
    configure_logging()  # idempotent
    assert ls._CONFIGURED is True

    print("ok")


if __name__ == "__main__":
    main()
