"""Indian mobile number normalization and validation."""

from __future__ import annotations

import re

_INDIAN_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


def normalize_phone(raw: str) -> str:
    """
    Normalize to a 10-digit Indian mobile number.

    Accepts optional ``+91`` / ``91`` country prefix or a leading trunk ``0``;
    strips spaces and dashes. The stored value is always 10 digits starting with 6–9.
    """
    s = (raw or "").strip().replace(" ", "").replace("-", "")
    if s.startswith("+91"):
        s = s[3:]
    elif s.startswith("91") and len("".join(c for c in s if c.isdigit())) == 12:
        s = s[2:]
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not _INDIAN_MOBILE_RE.match(digits):
        raise ValueError(
            "Enter a valid 10-digit Indian mobile number (must start with 6, 7, 8, or 9)"
        )
    return digits
