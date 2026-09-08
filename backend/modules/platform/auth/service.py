import uuid
from datetime import datetime, timedelta, timezone
import hashlib
import logging
import os
import secrets
from urllib.parse import quote

from jose import JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from core.captcha import captcha_is_valid
from core.config import get_settings
from core.request_context import set_user_id
from core.session_idle import SessionIdleExpiredError, assert_refresh_session_active
from core.password_policy import PasswordExpiredError, is_password_expired
from core.password_policy import validate_password
from core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from modules.platform.auth.model import PasswordResetToken, UserSession
from modules.platform.settings.lookup import get_setting
from core.permissions import get_flat_permission_codes_for_user, user_has_mobile_access
from modules.platform.auth.login_result import (
    CaptchaInvalidError,
    ForgotPasswordAccountInactiveError,
    ForgotPasswordDeliveryError,
    ForgotPasswordUserNotFoundError,
    LoginOutcome,
    LoginOutcomeMfaOtp,
    LoginOutcomeMfaSetup,
    LoginOutcomeTokens,
    MobileAccessDeniedError,
    PasswordLoginDisabledError,
)
from modules.platform.auth.schema import LoginRequest, TokenPair, UserMe
from modules.platform.auth_policy.service import get_global_policy
from modules.errors import NotFoundError
from modules.platform.mfa.service import MfaService
from modules.platform.rbac_audit.service import RbacAuditService
from modules.platform.users.model import User
from modules.platform.emails.service import EmailNotificationService

logger = logging.getLogger(__name__)


class InvalidCredentialsError(Exception):
    pass


class AccountLockedError(Exception):
    pass


ACCOUNT_LOCKED_MESSAGE = (
    "Your account has been locked due to multiple failed login attempts. "
    "Please contact an administrator."
)


class InvalidRefreshTokenError(Exception):
    pass


class AuthService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _access_token_lifetime(self) -> timedelta:
        """JWT lifetime; idle enforcement is separate (``SessionIdleMiddleware``)."""
        settings = get_settings()
        return timedelta(minutes=settings.access_token_expire_minutes)

    def _issue_token_pair(self, user: User, *, auth_method: str = "password") -> TokenPair:
        settings = get_settings()
        jti = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        method = (auth_method or "password").strip().lower()
        if method not in ("password", "sso"):
            method = "password"
        access = create_access_token(
            {"sub": str(user.id), "jti": jti, "amr": method},
            expires_delta=self._access_token_lifetime(),
        )
        delta = timedelta(days=settings.refresh_token_expire_days)
        refresh = create_refresh_token(subject=str(user.id), jti=jti, expires_delta=delta)
        self._db.add(
            UserSession(
                refresh_jti=jti,
                user_id=user.id,
                expires_at=now + delta,
                last_activity_at=now,
                auth_method=method,
            )
        )
        self._db.commit()
        return TokenPair(access_token=access, refresh_token=refresh)

    def issue_token_pair(self, user: User, *, auth_method: str = "password") -> TokenPair:
        """Public: MFA verification, SSO, and other non-password login paths."""
        return self._issue_token_pair(user, auth_method=auth_method)

    def assert_client_access(self, user: User, client_type: str | None) -> None:
        if (client_type or "web").lower() != "mobile":
            return
        if user.is_superuser or user_has_mobile_access(self._db, int(user.id)):
            return
        raise MobileAccessDeniedError

    def _load_user_for_login(self, data: LoginRequest) -> User | None:
        if data.email is not None:
            email = str(data.email).lower().strip()
            return self._db.scalar(
                select(User)
                .where(User.email == email)
                .options(selectinload(User.org_units), selectinload(User.mfa_record))
            )
        if data.username is not None:
            uname = str(data.username).strip()
            return self._db.scalar(
                select(User)
                .where(User.username == uname)
                .options(selectinload(User.org_units), selectinload(User.mfa_record))
            )
        if data.phone:
            phone = str(data.phone).strip()
            return self._db.scalar(
                select(User)
                .where(User.phone == phone)
                .options(selectinload(User.org_units), selectinload(User.mfa_record))
            )
        return None

    def _max_failed_login_attempts(self) -> int:
        raw = get_setting("auth.max_failed_login_attempts")
        try:
            n = int(str(raw).strip()) if raw else 5
        except ValueError:
            n = 5
        return min(20, max(0, n))

    def _send_account_locked_email(self, user: User) -> None:
        email = (user.email or "").strip()
        if not email:
            return
        try:
            EmailNotificationService(self._db).trigger_event(
                event_code="ACCOUNT_LOCKED",
                payload={
                    "user_name": user.full_name,
                    "email": email,
                    "company_name": "Takeda Asset Management",
                },
            )
        except Exception:
            logger.exception("account_locked_email_failed", extra={"user_id": int(user.id)})

    def _note_failed_login(self, user: User) -> None:
        """Increment failures and lock when the policy threshold is reached."""
        limit = self._max_failed_login_attempts()
        if limit <= 0 or user.locked_at is not None:
            return
        user.failed_login_attempts = int(user.failed_login_attempts or 0) + 1
        just_locked = user.failed_login_attempts >= limit
        if just_locked:
            user.locked_at = datetime.now(timezone.utc)
            RbacAuditService(self._db).log(
                actor_user_id=None,
                target_type="user",
                target_id=int(user.id),
                action="account_locked",
                old_value={"locked": False},
                new_value={"locked": True},
            )
        self._db.commit()
        if just_locked:
            self._send_account_locked_email(user)
            raise AccountLockedError

    def login_outcome(self, data: LoginRequest) -> LoginOutcome:
        user = self._load_user_for_login(data)
        if user is not None and user.locked_at is not None:
            logger.warning(
                "login_failed",
                extra={"event": "login_failed", "reason": "account_locked", "user_id": int(user.id)},
            )
            raise AccountLockedError
        if (
            user is None
            or not user.is_active
            or not verify_password(data.password, user.hashed_password)
        ):
            if user is not None and user.is_active:
                self._note_failed_login(user)
            logger.warning("login_failed", extra={"event": "login_failed", "reason": "invalid_credentials"})
            raise InvalidCredentialsError
        if int(user.failed_login_attempts or 0) > 0:
            user.failed_login_attempts = 0
            self._db.commit()
        if is_password_expired(user):
            logger.warning(
                "login_failed",
                extra={"event": "login_failed", "reason": "password_expired", "user_id": int(user.id)},
            )
            raise PasswordExpiredError

        set_user_id(int(user.id))
        self.assert_client_access(user, data.client_type)

        if user.is_superuser:
            logger.info("login_ok", extra={"event": "login_ok", "outcome": "tokens", "auth_method": "password"})
            return LoginOutcomeTokens(tokens=self._issue_token_pair(user))

        pol = get_global_policy(self._db)
        if not pol.password_enabled:
            logger.warning(
                "login_failed",
                extra={"event": "login_failed", "reason": "password_login_disabled", "user_id": int(user.id)},
            )
            raise PasswordLoginDisabledError
        if pol.captcha_enabled and not captcha_is_valid(
            token=data.captcha_token, captcha_enabled=True
        ):
            logger.warning(
                "login_failed",
                extra={"event": "login_failed", "reason": "captcha_invalid", "user_id": int(user.id)},
            )
            raise CaptchaInvalidError

        if not pol.mfa_enabled:
            logger.info("login_ok", extra={"event": "login_ok", "outcome": "tokens", "auth_method": "password"})
            return LoginOutcomeTokens(tokens=self._issue_token_pair(user))

        mfa = user.mfa_record
        setup_ok = mfa is not None and bool(mfa.setup_completed) and bool(mfa.is_enabled)
        if not setup_ok:
            if pol.mfa_enforced:
                msvc = MfaService(self._db)
                raw = msvc.create_setup_token(int(user.id))
                exp_min = int((os.environ.get("MFA_SETUP_TOKEN_EXPIRE_MINUTES") or "10080").strip() or "10080")
                logger.info("login_ok", extra={"event": "login_ok", "outcome": "mfa_setup"})
                return LoginOutcomeMfaSetup(setup_token=raw, expires_in_seconds=max(60, exp_min * 60))
            logger.info("login_ok", extra={"event": "login_ok", "outcome": "tokens", "auth_method": "password"})
            return LoginOutcomeTokens(tokens=self._issue_token_pair(user))

        msvc = MfaService(self._db)
        ch = msvc.create_login_challenge(int(user.id))
        logger.info("login_ok", extra={"event": "login_ok", "outcome": "mfa_otp"})
        return LoginOutcomeMfaOtp(challenge_token=ch, expires_in_seconds=600)

    def refresh(self, refresh_token: str) -> TokenPair:
        settings = get_settings()
        try:
            payload = decode_refresh_token(refresh_token)
        except JWTError as exc:
            raise InvalidRefreshTokenError from exc
        jti = payload.get("jti")
        sub = payload.get("sub")
        if not jti or not isinstance(jti, str) or sub is None:
            raise InvalidRefreshTokenError
        user_id = int(sub) if isinstance(sub, str) else int(sub)
        now = datetime.now(timezone.utc)
        row = self._db.scalar(
            select(UserSession).where(
                UserSession.refresh_jti == jti,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
        )
        if row is None:
            logger.warning("refresh_failed", extra={"event": "refresh_failed", "reason": "session_missing"})
            raise InvalidRefreshTokenError
        try:
            assert_refresh_session_active(self._db, row)
        except SessionIdleExpiredError as exc:
            logger.warning(
                "refresh_failed",
                extra={"event": "refresh_failed", "reason": "idle_expired", "user_id": user_id},
            )
            raise InvalidRefreshTokenError from exc

        user = self._db.get(User, user_id)
        if user is None or not bool(user.is_active):
            row.revoked_at = now
            self._db.commit()
            logger.warning(
                "refresh_failed",
                extra={"event": "refresh_failed", "reason": "user_inactive", "user_id": user_id},
            )
            raise InvalidRefreshTokenError
        set_user_id(user_id)

        row.revoked_at = now
        new_jti = str(uuid.uuid4())
        delta = timedelta(days=settings.refresh_token_expire_days)
        auth_method = (getattr(row, "auth_method", None) or "password").strip().lower()
        if auth_method not in ("password", "sso"):
            auth_method = "password"
        new_refresh = create_refresh_token(
            subject=str(user_id), jti=new_jti, expires_delta=delta
        )
        self._db.add(
            UserSession(
                refresh_jti=new_jti,
                user_id=user_id,
                expires_at=now + delta,
                last_activity_at=now,
                auth_method=auth_method,
            )
        )
        access = create_access_token(
            {"sub": str(user_id), "jti": new_jti, "amr": auth_method},
            expires_delta=self._access_token_lifetime(),
        )
        self._db.commit()
        return TokenPair(access_token=access, refresh_token=new_refresh)

    def get_me(self, user_id: int) -> User:
        user = self._db.scalar(
            select(User)
            .where(User.id == user_id)
            .options(
                selectinload(User.roles),
                selectinload(User.org_units),
                selectinload(User.departments),
                selectinload(User.cost_centers),
            )
        )
        if user is None:
            raise NotFoundError("User", user_id)
        return user

    def get_me_public(self, user_id: int) -> UserMe:
        user = self.get_me(user_id)
        codes = get_flat_permission_codes_for_user(self._db, user_id)
        role_names = sorted({r.name for r in user.roles})
        role_display = ", ".join(role_names) if role_names else None
        plant_names = [ou.name for ou in (user.org_units or []) if (ou.name or "").strip()]
        dept_labels = [
            f"{d.code} — {d.name}" if (d.code or "").strip() else d.name
            for d in (user.departments or [])
            if (d.name or "").strip() or (d.code or "").strip()
        ]
        cc_labels = [
            f"{c.code} — {c.name}" if (c.name or "").strip() else c.code
            for c in (user.cost_centers or [])
            if (c.code or "").strip()
        ]
        return UserMe(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            phone=user.phone,
            created_at=user.created_at,
            is_superuser=user.is_superuser,
            is_active=user.is_active,
            role=role_display,
            org_unit=", ".join(plant_names) if plant_names else None,
            department=", ".join(dept_labels) if dept_labels else None,
            cost_center=", ".join(cc_labels) if cc_labels else None,
            permissions=codes,
        )

    def forgot_password(self, *, email: str) -> None:
        email_norm = (email or "").strip().lower()
        if not email_norm or "@" not in email_norm:
            raise ForgotPasswordUserNotFoundError()

        user = self._db.scalar(select(User).where(User.email == email_norm))
        if user is None:
            raise ForgotPasswordUserNotFoundError()
        if not user.is_active:
            raise ForgotPasswordAccountInactiveError()

        raw = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        expires_minutes = int((os.environ.get("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES") or "30").strip() or "30")
        if expires_minutes < 5:
            expires_minutes = 5
        now = datetime.now(timezone.utc)
        row = PasswordResetToken(
            user_id=int(user.id), token_hash=token_hash, expires_at=now + timedelta(minutes=expires_minutes)
        )
        self._db.add(row)
        self._db.commit()

        base = (os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip(
            "/"
        )
        reset_link = f"{base}/reset-password?token={quote(raw, safe='')}"
        result = EmailNotificationService(self._db).trigger_event(
            event_code="FORGOT_PASSWORD",
            payload={
                "user_name": user.full_name,
                "email": user.email,
                "reset_link": reset_link,
                "company_name": "Takeda Asset Management",
                "expiry_minutes": expires_minutes,
            },
        )
        if result.status != "sent":
            hint = result.error or "Email could not be sent."
            if result.status == "skipped":
                hint = (
                    "Password reset email is not configured. Enable the FORGOT_PASSWORD template mapping "
                    "and SMTP in Settings."
                )
            raise ForgotPasswordDeliveryError(hint)

    def reset_password(self, *, token: str, new_password: str) -> None:
        raw = (token or "").strip()
        if not raw:
            raise ValueError("Invalid token")
        validate_password(new_password)

        token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        row = self._db.scalar(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
        if row is None:
            raise ValueError("Invalid or expired token")

        user = self._db.get(User, int(row.user_id))
        if user is None:
            raise ValueError("Invalid token")
        if not bool(user.is_active):
            row.used_at = now
            self._db.commit()
            raise ValueError("Invalid or expired token")

        user.hashed_password = hash_password(new_password)
        user.password_changed_at = now
        row.used_at = now
        self._db.commit()

        if user.email:
            EmailNotificationService(self._db).trigger_event(
                event_code="PASSWORD_RESET",
                payload={
                    "user_name": user.full_name,
                    "email": user.email,
                    "company_name": "Takeda Asset Management",
                },
            )
