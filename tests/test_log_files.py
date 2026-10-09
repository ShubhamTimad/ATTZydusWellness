"""Daily log files per category, retention, and quiet /health behind --root-path."""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import core.logging_setup as ls
from core.request_logging_middleware import RequestLoggingMiddleware


@pytest.fixture
def isolated_root(monkeypatch: pytest.MonkeyPatch):
    root = logging.getLogger()
    saved = (root.handlers[:], root.filters[:], root.level)
    monkeypatch.setattr(ls, "_CONFIGURED", False)
    monkeypatch.setenv("LOG_FORMAT", "json")
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    monkeypatch.delenv("ERROR_ALERT_EMAILS", raising=False)
    yield
    for h in root.handlers:
        if h not in saved[0]:
            h.close()
    root.handlers[:], root.filters[:] = saved[0], saved[1]
    root.setLevel(saved[2])


def _lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def test_log_dir_splits_by_category(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, isolated_root) -> None:
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    ls.configure_logging()

    logging.getLogger("app.access").info("GET /x → 200")
    logging.getLogger("modules.platform.auth.service").info("login_ok")
    logging.getLogger("modules.orders.service").error("boom")
    logging.getLogger("modules.platform.audit.middleware").info("not auth")

    today = ls._utc_today().isoformat()
    files = {name: tmp_path / name / f"{name}-{today}.log" for name in ("all", "access", "error", "auth")}
    messages = {name: [r["message"] for r in _lines(p)] for name, p in files.items()}

    assert {"GET /x → 200", "login_ok", "boom", "not auth"} <= set(messages["all"])
    assert messages["access"] == ["GET /x → 200"]
    assert messages["error"] == ["boom"]
    assert messages["auth"] == ["login_ok"]


def test_daily_handler_rolls_over_and_purges(tmp_path: Path) -> None:
    old = tmp_path / "all-2000-01-01.log"
    old.write_text("old\n")
    keep = tmp_path / "all-not-a-date.log"
    keep.write_text("x\n")

    handler = ls.DailyFileHandler(str(tmp_path), "all", retention_days=30)
    assert not old.exists()
    assert keep.exists()

    handler.day = handler.day - timedelta(days=1)
    yesterday_file = Path(handler._path())
    yesterday_file.write_text("")
    handler.emit(logging.makeLogRecord({"msg": "after midnight", "levelno": logging.INFO}))
    handler.close()

    assert yesterday_file.read_text() == ""
    assert "after midnight" in Path(handler.baseFilename).read_text()


def test_health_is_quiet_behind_root_path_unless_failing(caplog: pytest.LogCaptureFixture) -> None:
    app = FastAPI(root_path="/api")
    app.add_middleware(RequestLoggingMiddleware)
    state = {"ok": True}

    @app.get("/health")
    def health():
        return {"status": "ok"} if state["ok"] else JSONResponse(status_code=503, content={})

    # Uvicorn --root-path puts the prefix into scope["path"]; TestClient does the same with this URL.
    client = TestClient(app, root_path="/api")
    with caplog.at_level(logging.DEBUG, logger="app.access"):
        assert client.get("/api/health").status_code == 200
        state["ok"] = False
        assert client.get("/api/health").status_code == 503

    levels = [r.levelno for r in caplog.records if r.name == "app.access"]
    assert levels == [logging.DEBUG, logging.ERROR]
