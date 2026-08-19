from pydantic import BaseModel, Field


class PasswordPolicyPublic(BaseModel):
    min_length: int = Field(ge=1, le=256, default=8)
    require_uppercase: bool = False
    require_lowercase: bool = False
    require_digit: bool = False
    require_special: bool = False
    max_age_days: int = Field(
        default=90,
        ge=0,
        le=36_500,
        description="0 disables password expiry.",
    )


class AuthPolicyPublic(BaseModel):
    password_enabled: bool = True
    mfa_enabled: bool = False
    captcha_enabled: bool = False
    mfa_enforced: bool = False


class EmailDeliveryPublic(BaseModel):
    """SMTP settings for onboarding and notification emails (superadmin Settings tab)."""

    delivery_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: str = Field(
        default="",
        description="Leave empty on update to keep the stored password.",
    )
    password_configured: bool = False
    smtp_use_tls: bool = True
    smtp_from_email: str = ""
    smtp_from_name: str = ""


class EmailDeliveryTestRequest(BaseModel):
    to_email: str = Field(min_length=3, max_length=255)
    config: EmailDeliveryPublic | None = Field(
        default=None,
        description="Current form values; used when testing before save.",
    )


class SessionIdleSettingsPublic(BaseModel):
    """Minutes without user interaction (or API use) before automatic sign-out."""

    idle_timeout_minutes: int = Field(
        default=10,
        ge=1,
        le=24 * 60,
        description="Applied to every user session.",
    )


class AppVersionPublic(BaseModel):
    """Display version for the login screen (editable in Settings)."""

    version: str = Field(default="1.0.0", min_length=1, max_length=64)


class DocumentSignatureFlags(BaseModel):
    """Which print/PDF flows render approval signature lines above the footer."""

    capex: bool = True
    reports: bool = False
    transfer: bool = False
    disposal: bool = False


class DocumentFormatPublic(BaseModel):
    """Shared PDF/Excel header-footer copy. Used by reports and CapEx print."""

    org_name: str = Field(default="Takeda", max_length=80)
    product_name: str = Field(default="", max_length=120, description="Deprecated — unused in PDF/Excel chrome.")
    confidential_line: str = Field(default="Confidential — internal use only", max_length=160)
    excel_include_title: bool = True
    signatures: DocumentSignatureFlags = Field(default_factory=DocumentSignatureFlags)


class FinancialYearSettingsPublic(BaseModel):
    """Inclusive start date; end is the day before the next year's start."""

    start_month: int = Field(default=4, ge=1, le=12, description="Month financial year begins (e.g. 4 = April).")
    start_day: int = Field(default=1, ge=1, le=31)
    period_label: str = Field(
        default="",
        description="Computed label for the financial year containing today (read-only on GET).",
    )
    period_start: str = Field(default="", description="ISO date — read-only on GET.")
    period_end: str = Field(default="", description="ISO date — read-only on GET.")
