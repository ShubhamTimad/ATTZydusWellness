"""Shared rate limits, org scope on detail, and a health check that sees the database."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import HTTPException

from modules.platform.users.scope import ViewerOrgScope, viewer_can_see_org


def test_cost_center_scope_allows_either_side() -> None:
    scope = ViewerOrgScope(frozenset({1}), frozenset({(1, "CC2")}), frozenset({9}))
    assert viewer_can_see_org(scope, plant_id=1, cost_center_ids=(4, 9))
    assert not viewer_can_see_org(scope, plant_id=1, cost_center_ids=(4,))


def test_plant_scope_when_no_cost_centers() -> None:
    scope = ViewerOrgScope(frozenset({3}), None, None)
    assert viewer_can_see_org(scope, plant_id=3, cost_center_ids=())
    assert not viewer_can_see_org(scope, plant_id=8, cost_center_ids=(1,))


def test_unrestricted_scope_sees_every_record() -> None:
    scope = ViewerOrgScope(None, None, None)
    assert viewer_can_see_org(scope, plant_id=None, cost_center_ids=())


def test_bucket_is_shared_through_the_state_file(monkeypatch, tmp_path) -> None:
    from core import login_rate_limit as rl

    monkeypatch.setenv("RATE_LIMIT_STATE_PATH", str(tmp_path / "limits.json"))
    request = SimpleNamespace(client=SimpleNamespace(host="203.0.113.5"))
    rl.check_bucket(request, "forgot-password", max_hits=1, window_sec=60)
    try:
        rl.check_bucket(request, "forgot-password", max_hits=1, window_sec=60)
    except HTTPException as exc:
        assert exc.status_code == 429
    else:
        raise AssertionError("second hit should be limited")
    assert "forgot-password|203.0.113.5" in (tmp_path / "limits.json").read_text()


def test_health_is_unavailable_when_database_is_down(monkeypatch) -> None:
    from app.main import health

    class _Down:
        def __enter__(self):
            raise OSError("db down")

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr("app.main.engine.connect", lambda: _Down())
    response = health()
    assert response.status_code == 503
    assert response.body
