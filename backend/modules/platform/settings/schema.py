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
    max_failed_login_attempts: int = Field(
        default=5,
        ge=0,
        le=20,
        description="Lock the account after this many consecutive failed password attempts. 0 disables lockout.",
    )
    # From SSO settings (read-only on PUT /auth-policy; edit via /settings/sso).
    sso_enabled: bool = False
    sso_button_label: str = "Sign in with SSO"


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


class SsoSettingsPublic(BaseModel):
    """Provider-agnostic OIDC SSO (Microsoft Entra, Okta, Auth0, Keycloak, etc.)."""

    enabled: bool = False
    button_label: str = Field(
        default="Sign In with SSO",
        max_length=80,
        description="Label shown on the login button.",
    )
    issuer: str = Field(
        default="",
        max_length=512,
        description="OIDC issuer URL, e.g. https://login.microsoftonline.com/{tenant}/v2.0",
    )
    client_id: str = Field(default="", max_length=255)
    client_secret: str = Field(
        default="",
        description="Leave empty on update to keep the stored secret.",
    )
    client_secret_configured: bool = False
    redirect_uri: str = Field(
        default="",
        max_length=512,
        description="Must match the IdP app registration callback URL.",
    )
    scopes: str = Field(
        default="openid profile email",
        max_length=255,
        description="Space-separated OIDC scopes.",
    )
    email_claim: str = Field(
        default="email",
        max_length=64,
        description="ID token claim used to match User.email (email or preferred_username).",
    )
    subject_claim: str = Field(
        default="sub",
        max_length=64,
        description="Stable IdP subject claim (sub, or oid for Entra).",
    )
    allow_jit: bool = Field(
        default=False,
        description="If true, create an ATT user on first successful SSO (otherwise pre-provision only).",
    )


class SessionIdleSettingsPublic(BaseModel):
    """Admin idle settings and/or effective policy for the current session."""

    idle_timeout_minutes: int = Field(
        default=10,
        ge=0,
        le=24 * 60,
        description="Minutes of inactivity before sign-out when idle applies.",
    )
    idle_enabled: bool = Field(
        default=True,
        description="Client policy: when false, do not auto sign-out for inactivity (navbar timer off).",
    )
    apply_to_sso: bool = Field(
        default=False,
        description="Admin: when true, SSO sessions use the same idle minutes; when false (default), SSO skips idle.",
    )


class AppVersionPublic(BaseModel):
    """Display version for the login screen (editable in Settings)."""

    version: str = Field(default="1.0.0", min_length=1, max_length=64)


class LoginBackgroundMetaPublic(BaseModel):
    """Whether a custom login background image is configured."""

    configured: bool = False
    content_type: str | None = None
    version: str | None = None


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
