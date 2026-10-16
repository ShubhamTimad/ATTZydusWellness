"""Limits for login and other auth posts, shared by every worker in this container.

ponytail: one JSON file plus a lock. A second backend container does not see these
counters; point RATE_LIMIT_STATE_PATH at a shared volume or move the store to Redis.
"""

from __future__ import annotations

import fcntl
import json
import os
import threading
import time
from pathlib import Path

from fastapi import HTTPException, Request, status

_LOCK = threading.Lock()
_MAX_ATTEMPTS_PER_MINUTE = 30
_ATTEMPT_WINDOW_SEC = 60.0
_MAX_FAILURES = 10
_FAILURE_WINDOW_SEC = 900.0
_LOCKOUT_SEC = 900.0
_KEEP_SEC = 3600.0


def _state_path() -> Path:
    raw = (os.environ.get("RATE_LIMIT_STATE_PATH") or "").strip()
    if raw:
        return Path(raw)
    return Path("/tmp/takeda-att-rate-limit.json")


def _client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _fresh(stamps: list, now: float, window: float) -> list[float]:
    return [float(t) for t in stamps if float(t) >= now - window]


def _load(raw: str) -> dict:
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _mutate(update):
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        with path.open("a+", encoding="utf-8") as fh:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            try:
                fh.seek(0)
                state = _load(fh.read())
                result = update(state, time.time())
                _prune(state, time.time())
                fh.seek(0)
                fh.truncate()
                fh.write(json.dumps(state))
                fh.flush()
                return result
            finally:
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def _prune(state: dict, now: float) -> None:
    for bucket in ("attempts", "failures", "buckets"):
        group = state.get(bucket)
        if not isinstance(group, dict):
            continue
        empty = []
        for key, stamps in group.items():
            kept = _fresh(stamps if isinstance(stamps, list) else [], now, _KEEP_SEC)
            if kept:
                group[key] = kept
            else:
                empty.append(key)
        for key in empty:
            group.pop(key, None)
    locked = state.get("locked_until")
    if isinstance(locked, dict):
        for key in [k for k, until in locked.items() if float(until) <= now]:
            locked.pop(key, None)


def check_login_allowed(request: Request) -> str:
    """Raise 429 when the client is locked out or over the per-minute budget."""
    ip = _client_ip(request)

    def update(state: dict, now: float) -> None:
        locked = state.setdefault("locked_until", {})
        until = float(locked.get(ip, 0.0) or 0.0)
        if now < until:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Try again later.",
            )
        attempts = state.setdefault("attempts", {})
        dq = _fresh(attempts.get(ip, []), now, _ATTEMPT_WINDOW_SEC)
        if len(dq) >= _MAX_ATTEMPTS_PER_MINUTE:
            attempts[ip] = dq
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again in a minute.",
            )
        dq.append(now)
        attempts[ip] = dq

    _mutate(update)
    return ip


def record_login_failure(ip: str) -> None:
    def update(state: dict, now: float) -> None:
        failures = state.setdefault("failures", {})
        dq = _fresh(failures.get(ip, []), now, _FAILURE_WINDOW_SEC)
        dq.append(now)
        failures[ip] = dq
        if len(dq) >= _MAX_FAILURES:
            state.setdefault("locked_until", {})[ip] = now + _LOCKOUT_SEC

    _mutate(update)


def check_bucket(request: Request, bucket: str, *, max_hits: int, window_sec: float) -> None:
    """Per-IP counter shared by every worker in this container."""
    ip = _client_ip(request)
    key = f"{bucket}|{ip}"

    def update(state: dict, now: float) -> None:
        buckets = state.setdefault("buckets", {})
        dq = _fresh(buckets.get(key, []), now, window_sec)
        if len(dq) >= max_hits:
            buckets[key] = dq
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again later.",
            )
        dq.append(now)
        buckets[key] = dq

    _mutate(update)


def clear_login_failures(ip: str) -> None:
    def update(state: dict, now: float) -> None:
        _ = now
        state.setdefault("failures", {}).pop(ip, None)
        state.setdefault("locked_until", {}).pop(ip, None)

    _mutate(update)
