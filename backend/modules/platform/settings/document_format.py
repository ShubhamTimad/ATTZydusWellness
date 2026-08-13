"""PDF/Excel chrome + which print flows include signature blocks."""

from __future__ import annotations

import json
from contextlib import contextmanager
from contextvars import ContextVar

from modules.platform.settings.schema import DocumentFormatPublic, DocumentSignatureFlags

_preview: ContextVar[DocumentFormatPublic | None] = ContextVar("document_format_preview", default=None)

SETTING_KEY = "documents.format"

DEFAULTS = DocumentFormatPublic(
    org_name="Takeda",
    product_name="",
    confidential_line="Confidential — internal use only",
    excel_include_title=True,
    signatures=DocumentSignatureFlags(),
)


def parse_document_format(raw: str | None) -> DocumentFormatPublic:
    if not raw:
        return DEFAULTS.model_copy(deep=True)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return DEFAULTS.model_copy(deep=True)
    if not isinstance(data, dict):
        return DEFAULTS.model_copy(deep=True)
    merged = DEFAULTS.model_dump()
    merged.update({k: v for k, v in data.items() if k != "signatures"})
    sigs = data.get("signatures")
    if isinstance(sigs, dict):
        merged["signatures"] = {**DEFAULTS.signatures.model_dump(), **sigs}
    return DocumentFormatPublic.model_validate(merged)


def get_document_format() -> DocumentFormatPublic:
    override = _preview.get()
    if override is not None:
        return override
    from modules.platform.settings.lookup import get_setting

    return parse_document_format(get_setting(SETTING_KEY))


@contextmanager
def previewing(fmt: DocumentFormatPublic):
    """Use unsaved settings for PDF/Excel build without writing the DB."""
    token = _preview.set(fmt)
    try:
        yield
    finally:
        _preview.reset(token)


def footer_brand(fmt: DocumentFormatPublic | None = None) -> str:
    f = fmt or get_document_format()
    return f.org_name.strip() or DEFAULTS.org_name


if __name__ == "__main__":
    parsed = parse_document_format('{"org_name":"Acme","signatures":{"reports":true}}')
    assert parsed.org_name == "Acme"
    assert parsed.signatures.reports is True
    assert parsed.signatures.capex is True
    assert parsed.excel_include_title is True
    assert parse_document_format("not json").org_name == DEFAULTS.org_name
    with previewing(parsed):
        assert get_document_format().org_name == "Acme"
    print("document_format ok")
