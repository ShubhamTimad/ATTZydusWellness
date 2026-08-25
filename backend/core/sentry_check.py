"""Self-check for Sentry setup helpers.

Run: PYTHONPATH=backend python -m core.sentry_check
"""

from __future__ import annotations

import os


def main() -> None:
    import core.sentry_setup as ss

    ss._ENABLED = False
    os.environ.pop("SENTRY_DSN", None)
    assert ss.init_sentry() is False
    assert ss.sentry_enabled() is False

    # Capture / scope helpers must no-op when disabled.
    ss.capture_exception(RuntimeError("should not send"))
    ss.set_request_scope(request_id="rid1", user_id=7)
    ss.clear_request_scope()

    assert ss._float_env("SENTRY_TRACES_SAMPLE_RATE", 0.1) == 0.1
    os.environ["SENTRY_TRACES_SAMPLE_RATE"] = "0.5"
    assert ss._float_env("SENTRY_TRACES_SAMPLE_RATE", 0.1) == 0.5
    os.environ["SENTRY_TRACES_SAMPLE_RATE"] = "2"
    assert ss._float_env("SENTRY_TRACES_SAMPLE_RATE", 0.1) == 1.0
    os.environ.pop("SENTRY_TRACES_SAMPLE_RATE", None)

    # before_send drops 4xx HTTP-like exceptions
    class _HttpExc(Exception):
        status_code = 404

    dropped = ss._before_send({"request": {}}, {"exc_info": (type(_HttpExc()), _HttpExc(), None)})
    assert dropped is None

    kept = ss._before_send(
        {"request": {"headers": {"Authorization": "Bearer secret", "X-Request-ID": "abc"}}},
        {},
    )
    assert kept is not None
    assert kept["request"]["headers"]["Authorization"] == "[Filtered]"
    assert kept["request"]["headers"]["X-Request-ID"] == "abc"

    print("ok")


if __name__ == "__main__":
    main()
