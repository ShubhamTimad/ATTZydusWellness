"""
Captcha validation.

When captcha is required, verification fails closed unless CAPTCHA_SECRET and
CAPTCHA_VERIFY_URL are set (Cloudflare Turnstile or reCAPTCHA siteverify).
Set CAPTCHA_SKIP_VALIDATION=1 only in local development.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)


def captcha_is_valid(*, token: str | None, captcha_enabled: bool) -> bool:
    if not captcha_enabled:
        return True
    t = (token or "").strip()
    if not t:
        return False
    if (os.environ.get("CAPTCHA_SKIP_VALIDATION") or "").strip().lower() in ("1", "true", "yes"):
        return True
    secret = (os.environ.get("CAPTCHA_SECRET") or "").strip()
    url = (os.environ.get("CAPTCHA_VERIFY_URL") or "").strip()
    if not secret or not url:
        logger.error("captcha_not_configured")
        return False
    try:
        res = httpx.post(url, data={"secret": secret, "response": t}, timeout=5.0)
        body = res.json()
    except Exception:
        logger.exception("captcha_verify_failed")
        return False
    return bool(isinstance(body, dict) and body.get("success"))
