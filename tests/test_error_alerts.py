from __future__ import annotations

import logging

from core.error_alerts import ErrorEmailHandler
from core.request_context import clear_request_context, set_request_id


def _logger(handler: ErrorEmailHandler) -> logging.Logger:
    log = logging.getLogger("tests.error_alerts")
    log.handlers = [handler]
    log.propagate = False
    log.setLevel(logging.INFO)
    return log


def _boom() -> None:
    1 / 0


def test_error_is_emailed_once_per_window_with_traceback(monkeypatch) -> None:
    monkeypatch.setenv("FRONTEND_APP_URL", "https://assets.example.com")
    handler = ErrorEmailHandler(["ops@example.com"])
    sent: list[tuple[str, str]] = []
    handler._dispatch = lambda subject, body: sent.append((subject, body))
    log = _logger(handler)

    set_request_id("req-123")
    log.info("all good")
    for _ in range(3):
        try:
            _boom()
        except ZeroDivisionError:
            log.exception("unhandled_exception", extra={"method": "POST", "path": "/assets/<b>"})
    clear_request_context()

    assert len(sent) == 1
    subject, body = sent[0]
    assert subject.startswith("[assets.example.com] ERROR: ZeroDivisionError")
    assert "req-123" in body
    assert "Traceback" in body and "1 / 0" in body
    assert "/assets/&lt;b&gt;" in body

    handler._last_sent.clear()
    try:
        _boom()
    except ZeroDivisionError:
        log.exception("unhandled_exception")
    assert "2 since the previous alert" in sent[1][1]


def test_handler_ignores_records_from_its_own_send_thread() -> None:
    import threading

    handler = ErrorEmailHandler(["ops@example.com"])
    sent: list[str] = []
    handler._dispatch = lambda subject, body: sent.append(subject)
    log = _logger(handler)

    t = threading.Thread(target=lambda: log.error("smtp blew up"), name="error-alert")
    t.start()
    t.join()
    assert sent == []
