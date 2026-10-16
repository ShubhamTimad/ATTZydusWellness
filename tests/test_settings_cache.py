"""A uvicorn worker that did not handle the save must still see the new setting after the TTL."""

from __future__ import annotations

from types import SimpleNamespace

from modules.platform.settings import brand_logo, lookup


def test_other_worker_sees_saved_setting_after_ttl(monkeypatch) -> None:
    db_value: dict[str, str | None] = {"v": None}
    fake_db = SimpleNamespace(
        scalar=lambda _stmt: None if db_value["v"] is None else SimpleNamespace(value=db_value["v"]),
        close=lambda: None,
    )
    clock = {"t": 1000.0}
    monkeypatch.setattr(lookup, "SessionLocal", lambda: fake_db)
    monkeypatch.setattr(lookup.time, "monotonic", lambda: clock["t"])
    lookup.clear_setting_cache("test.key")

    assert lookup.get_setting("test.key") is None  # this worker caches "not set"
    db_value["v"] = "saved"  # another worker saves it; our cache is not cleared
    assert lookup.get_setting("test.key") is None  # still cached within the TTL
    clock["t"] += lookup.TTL_SECONDS
    assert lookup.get_setting("test.key") == "saved"
    lookup.clear_setting_cache("test.key")


def test_brand_logo_follows_stored_value(monkeypatch) -> None:
    stored: dict[str, str | None] = {"v": brand_logo.encode_brand_logo(b"logo-one", "image/png")}
    monkeypatch.setattr(brand_logo, "get_setting", lambda _key: stored["v"])
    brand_logo.clear_brand_logo_cache()
    try:
        assert brand_logo.get_brand_logo_bytes() == (b"logo-one", "image/png")
        stored["v"] = brand_logo.encode_brand_logo(b"logo-two", "image/png")
        assert brand_logo.get_brand_logo_bytes() == (b"logo-two", "image/png")
        stored["v"] = None
        assert brand_logo.get_brand_logo_bytes() is None
    finally:
        brand_logo.clear_brand_logo_cache()
