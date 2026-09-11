"""Assert log_event puts event + fields into JSON records."""

from __future__ import annotations

import json
import logging
from io import StringIO

from core.app_log import log_event
from core.logging_setup import ContextFilter, JsonFormatter


def test_log_event_emits_stable_event_key() -> None:
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(ContextFilter())
    log = logging.getLogger("tests.app_log")
    log.handlers.clear()
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False

    log_event(log, "physical_order_created", order_id=1, order_number="PVO-1", asset_count=2)
    payload = json.loads(buf.getvalue().strip())
    assert payload["event"] == "physical_order_created"
    assert payload["message"] == "physical_order_created"
    assert payload["order_id"] == 1
    assert payload["order_number"] == "PVO-1"
    assert payload["asset_count"] == 2
