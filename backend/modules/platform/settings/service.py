from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.password_policy import password_policy_admin_view
from modules.platform.settings.financial_year import financial_year_period_for, get_financial_year_config
from modules.platform.settings.session_idle import (
    MAX_IDLE_MINUTES,
    MIN_IDLE_MINUTES,
    SETTING_KEY as SESSION_IDLE_SETTING_KEY,
    get_session_idle_timeout_minutes,
)
from modules.platform.settings.lookup import clear_setting_cache
from modules.platform.settings.model import Setting
from modules.platform.settings.schema import (
    AppVersionPublic,
    AuthPolicyPublic,
    DocumentFormatPublic,
    EmailDeliveryPublic,
    FinancialYearSettingsPublic,
    PasswordPolicyPublic,
    SessionIdleSettingsPublic,
)
from modules.platform.settings.smtp_config import (
    get_smtp_config,
    normalize_smtp_host,
    resolve_smtp_config_error,
    smtp_config_from_public,
)
from modules.platform.users.model import User
from modules.platform.mfa.policy_hooks import maybe_send_mfa_setup_for_user


class SettingsService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_password_policy(self) -> PasswordPolicyPublic:
        return PasswordPolicyPublic.model_validate(password_policy_admin_view())

    def put_password_policy(self, payload: PasswordPolicyPublic) -> PasswordPolicyPublic:
        mapping: list[tuple[str, str]] = [
            ("password.min_length", str(payload.min_length)),
            (
                "password.require_uppercase",
                "true" if payload.require_uppercase else "false",
            ),
            (
                "password.require_lowercase",
                "true" if payload.require_lowercase else "false",
            ),
            ("password.require_digit", "true" if payload.require_digit else "false"),
            (
                "password.require_special",
                "true" if payload.require_special else "false",
            ),
            ("password.max_age_days", str(payload.max_age_days)),
        ]
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])
        return self.get_password_policy()

    def get_auth_policy(self) -> AuthPolicyPublic:
        def b(key: str, default: bool) -> bool:
            row = self._db.scalar(select(Setting).where(Setting.key == key))
            if row is None or row.value is None:
                return default
            return str(row.value).strip().lower() in ("1", "true", "yes", "on")

        return AuthPolicyPublic(
            password_enabled=b("auth.password_enabled", True),
            mfa_enabled=b("auth.mfa_enabled", False),
            captcha_enabled=b("auth.captcha_enabled", False),
            mfa_enforced=b("auth.mfa_enforced", False),
        )

    def put_auth_policy(self, payload: AuthPolicyPublic) -> AuthPolicyPublic:
        before = self.get_auth_policy()
        mapping: list[tuple[str, str]] = [
            ("auth.password_enabled", "true" if payload.password_enabled else "false"),
            ("auth.mfa_enabled", "true" if payload.mfa_enabled else "false"),
            ("auth.captcha_enabled", "true" if payload.captcha_enabled else "false"),
            ("auth.mfa_enforced", "true" if payload.mfa_enforced else "false"),
        ]
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])

        # If MFA was just enabled globally, send setup emails to all active users missing setup.
        if (not before.mfa_enabled) and payload.mfa_enabled:
            stmt = (
                select(User)
                .where(User.is_active.is_(True), User.is_superuser.is_(False))
                .options(selectinload(User.mfa_record), selectinload(User.org_units))
            )
            for u in self._db.scalars(stmt).unique().all():
                maybe_send_mfa_setup_for_user(self._db, u, event_code="MFA_SETUP_REQUIRED")

        return self.get_auth_policy()

    def get_email_delivery(self) -> EmailDeliveryPublic:
        def s(key: str, default: str = "") -> str:
            row = self._db.scalar(select(Setting).where(Setting.key == key))
            if row is None or row.value is None:
                return default
            return str(row.value).strip()

        def b(key: str, default: bool) -> bool:
            raw = s(key, "")
            if not raw:
                return default
            return raw.lower() in ("1", "true", "yes", "on")

        port_raw = s("smtp.port", "587")
        try:
            port = int(port_raw or "587")
        except ValueError:
            port = 587

        return EmailDeliveryPublic(
            delivery_enabled=b("email.delivery_enabled", False),
            smtp_host=normalize_smtp_host(s("smtp.host")),
            smtp_port=port,
            smtp_username=s("smtp.username"),
            smtp_password="",
            password_configured=bool(s("smtp.password")),
            smtp_use_tls=b("smtp.use_tls", True),
            smtp_from_email=s("smtp.from_email"),
            smtp_from_name=s("smtp.from_name"),
        )

    def put_email_delivery(self, payload: EmailDeliveryPublic) -> EmailDeliveryPublic:
        hint = resolve_smtp_config_error(payload)
        if hint and payload.delivery_enabled:
            raise ValueError(hint)
        smtp_host = normalize_smtp_host(payload.smtp_host)
        mapping: list[tuple[str, str]] = [
            ("email.delivery_enabled", "true" if payload.delivery_enabled else "false"),
            ("smtp.host", smtp_host),
            ("smtp.port", str(payload.smtp_port)),
            ("smtp.username", payload.smtp_username.strip()),
            ("smtp.use_tls", "true" if payload.smtp_use_tls else "false"),
            ("smtp.from_email", payload.smtp_from_email.strip()),
            ("smtp.from_name", payload.smtp_from_name.strip()),
        ]
        if payload.smtp_password.strip():
            mapping.append(("smtp.password", payload.smtp_password.strip()))
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])
        return self.get_email_delivery()

    def get_session_idle(self) -> SessionIdleSettingsPublic:
        return SessionIdleSettingsPublic(
            idle_timeout_minutes=get_session_idle_timeout_minutes(),
        )

    def put_session_idle(self, payload: SessionIdleSettingsPublic) -> SessionIdleSettingsPublic:
        minutes = max(
            MIN_IDLE_MINUTES,
            min(MAX_IDLE_MINUTES, int(payload.idle_timeout_minutes)),
        )
        self._upsert(SESSION_IDLE_SETTING_KEY, str(minutes))
        self._db.commit()
        clear_setting_cache(SESSION_IDLE_SETTING_KEY)
        return SessionIdleSettingsPublic(idle_timeout_minutes=minutes)

    def get_app_version(self) -> AppVersionPublic:
        from modules.platform.settings.app_version import get_app_version

        return AppVersionPublic(version=get_app_version())

    def put_app_version(self, payload: AppVersionPublic) -> AppVersionPublic:
        from modules.platform.settings.app_version import SETTING_KEY

        version = payload.version.strip() or "1.0.0"
        self._upsert(SETTING_KEY, version[:64])
        self._db.commit()
        clear_setting_cache(SETTING_KEY)
        return self.get_app_version()

    def get_financial_year(self) -> FinancialYearSettingsPublic:
        cfg = get_financial_year_config()
        period = financial_year_period_for()
        return FinancialYearSettingsPublic(
            start_month=cfg.start_month,
            start_day=cfg.start_day,
            period_label=period.label,
            period_start=period.start.isoformat(),
            period_end=period.end.isoformat(),
        )

    def put_financial_year(self, payload: FinancialYearSettingsPublic) -> FinancialYearSettingsPublic:
        mapping: list[tuple[str, str]] = [
            ("financial_year.start_month", str(payload.start_month)),
            ("financial_year.start_day", str(payload.start_day)),
        ]
        for key, value in mapping:
            self._upsert(key, value)
        self._db.commit()
        clear_setting_cache(*[k for k, _ in mapping])
        return self.get_financial_year()

    def get_document_format(self) -> DocumentFormatPublic:
        from modules.platform.settings.document_format import get_document_format

        return get_document_format()

    def put_document_format(self, payload: DocumentFormatPublic) -> DocumentFormatPublic:
        from modules.platform.settings.document_format import SETTING_KEY

        cleaned = DocumentFormatPublic(
            org_name=payload.org_name.strip() or "Takeda",
            product_name=payload.product_name.strip() or "Asset Tagging & Tracking",
            confidential_line=payload.confidential_line.strip() or "Confidential — internal use only",
            excel_include_title=payload.excel_include_title,
            signatures=payload.signatures,
        )
        self._upsert(SETTING_KEY, json.dumps(cleaned.model_dump(), separators=(",", ":")))
        self._db.commit()
        clear_setting_cache(SETTING_KEY)
        return cleaned

    def _stored_smtp_password(self) -> str | None:
        row = self._db.scalar(select(Setting).where(Setting.key == "smtp.password"))
        if row is None or row.value is None:
            return None
        raw = str(row.value).strip()
        return raw or None

    def send_test_email(
        self,
        *,
        to_email: str,
        config: EmailDeliveryPublic | None = None,
    ) -> None:
        from modules.platform.emails.service import EmailSender

        recipient = to_email.strip().lower()
        if not recipient:
            raise ValueError("to_email is required")

        cfg = None
        if config is not None:
            hint = resolve_smtp_config_error(config)
            if hint:
                raise ValueError(hint)
            cfg = smtp_config_from_public(
                config,
                stored_password=self._stored_smtp_password(),
            )
        else:
            cfg = get_smtp_config()

        if cfg is None:
            raise ValueError(
                "Email delivery is disabled or incomplete. Enable delivery, set SMTP host and From address, "
                "then save—or send the test with your current form values."
            )
        if cfg.username and not cfg.password:
            raise ValueError("App password is required for SMTP authentication.")

        sender = EmailSender()
        sender.send_email(
            to_email=recipient,
            subject="Test email — Ultra Workspace",
            body=(
                "<p>This is a test message from your workspace email settings.</p>"
                "<p>If you received this, SMTP is configured correctly.</p>"
            ),
            cfg=cfg,
        )

    def _upsert(self, key: str, value: str) -> None:
        row = self._db.scalar(select(Setting).where(Setting.key == key))
        if row is None:
            self._db.add(Setting(key=key, value=value))
        else:
            row.value = value
