"""Blocking SMTP send with strict timeouts (run from a thread pool in async routes)."""

from __future__ import annotations

import smtplib
import socket
from email.mime.text import MIMEText

from modules.settings.smtp_config import SmtpConfig

SMTP_TIMEOUT_SECONDS = 8


def _login_and_send(
    server: smtplib.SMTP,
    *,
    cfg: SmtpConfig,
    from_email: str,
    to_email: str,
    message: str,
) -> None:
    if cfg.username and cfg.password:
        server.login(cfg.username, cfg.password)
    server.sendmail(from_email, [to_email], message)


def send_via_smtp(
    cfg: SmtpConfig,
    *,
    to_email: str,
    subject: str,
    body: str,
) -> None:
    msg = MIMEText(body, "html", "utf-8")
    msg["Subject"] = subject
    msg["To"] = to_email
    from_email = cfg.from_email
    msg["From"] = f"{cfg.from_name} <{from_email}>" if cfg.from_name else from_email
    raw = msg.as_string()

    try:
        # Port 465: implicit TLS (Gmail SSL). Port 587: STARTTLS.
        if cfg.port == 465:
            with smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=SMTP_TIMEOUT_SECONDS) as server:
                _login_and_send(
                    server,
                    cfg=cfg,
                    from_email=from_email,
                    to_email=to_email,
                    message=raw,
                )
        else:
            with smtplib.SMTP(cfg.host, cfg.port, timeout=SMTP_TIMEOUT_SECONDS) as server:
                server.ehlo()
                if cfg.use_tls:
                    server.starttls()
                    server.ehlo()
                _login_and_send(
                    server,
                    cfg=cfg,
                    from_email=from_email,
                    to_email=to_email,
                    message=raw,
                )
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError(
            f"SMTP timed out after {SMTP_TIMEOUT_SECONDS}s connecting to {cfg.host}:{cfg.port}. "
            "Check host, port, firewall, and TLS settings."
        ) from exc
    except OSError as exc:
        raise RuntimeError(f"SMTP network error: {exc}") from exc
    except smtplib.SMTPAuthenticationError as exc:
        raise RuntimeError(
            "SMTP authentication failed. For Gmail, use an app password (not your login password)."
        ) from exc
    except smtplib.SMTPException as exc:
        raise RuntimeError(f"SMTP error: {exc}") from exc
