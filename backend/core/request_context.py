"""Request-scoped fields for technical logs (one stream; filter by these)."""

from __future__ import annotations

from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
user_id_var: ContextVar[str] = ContextVar("user_id", default="-")


def get_request_id() -> str:
    return request_id_var.get()


def get_user_id() -> str:
    return user_id_var.get()


def set_request_id(value: str) -> None:
    request_id_var.set(value or "-")


def set_user_id(value: int | str | None) -> None:
    if value is None or value == "":
        user_id_var.set("-")
    else:
        user_id_var.set(str(value))
    # Keep Sentry scope in sync when auth resolves the user mid-request.
    try:
        from core.sentry_setup import set_request_scope

        set_request_scope(request_id=get_request_id(), user_id=None if value in (None, "") else value)
    except Exception:
        pass


def clear_request_context() -> None:
    request_id_var.set("-")
    user_id_var.set("-")
