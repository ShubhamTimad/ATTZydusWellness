"""SSO button must show the IdP account picker, not silently reuse the browser session."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest

from modules.platform.auth import sso_oidc
from modules.platform.settings.sso_config import SsoConfig


@pytest.fixture(autouse=True)
def fake_idp(monkeypatch: pytest.MonkeyPatch) -> None:
    cfg = SsoConfig(
        enabled=True,
        button_label="Sign in with Microsoft",
        issuer="https://login.microsoftonline.com/tenant/v2.0",
        client_id="cid",
        client_secret="secret",
        redirect_uri="https://assets.example.com/api/auth/sso/callback",
        scopes="openid profile email",
        email_claim="email",
        subject_claim="oid",
        allow_jit=False,
    )
    monkeypatch.setattr(sso_oidc, "get_sso_config", lambda: cfg)
    monkeypatch.setattr(
        sso_oidc,
        "_fetch_discovery",
        lambda _cfg: {"authorization_endpoint": "https://login.example/authorize"},
    )


def _prompt(url: str) -> str:
    return parse_qs(urlsplit(url).query)["prompt"][0]


@pytest.mark.parametrize("given", [None, "", "bogus"])
def test_default_prompt_is_select_account(given: str | None) -> None:
    assert _prompt(sso_oidc.build_authorize_redirect(portal="user", prompt=given)) == "select_account"
    assert _prompt(sso_oidc.build_authorize_redirect(portal="admin", prompt=given)) == "select_account"


@pytest.mark.parametrize("given", ["none", "login", "select_account"])
def test_explicit_prompt_is_kept(given: str) -> None:
    assert _prompt(sso_oidc.build_authorize_redirect(portal="user", prompt=given)) == given
