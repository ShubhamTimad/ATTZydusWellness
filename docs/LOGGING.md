# Technical application logs

Ops/debug logs for the API process. Separate from **business audit** (who changed an asset/order — already in DB).

## Design

- **One stream** for the whole app (stdout; rotating file on the Docker volume). **Not** one file per user.
- Every line carries `request_id` and `user_id` (when known) so you can filter one flow end-to-end.
- Responses include `X-Request-ID` and JSON errors include `request_id`.
- Prefer structured `event=` fields via `core.app_log.log_event` for lifecycle breadcrumbs.

## Configuration

| Env | Default | Meaning |
|-----|---------|---------|
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `LOG_FORMAT` | `text` on TTY, else `json` | `json` or `text` |
| `ERROR_ALERT_EMAILS` | unset (off) | Comma-separated addresses. Every `ERROR`/`CRITICAL` log line is emailed (see below) |
| `ERROR_ALERT_THROTTLE_SECONDS` | `900` | Same error is emailed at most once per window; the next email reports how many repeats were skipped |
| `LOG_FILE` | unset locally; `logs/app.log` in Docker | Optional path; same events also always go to stdout. Rotates at 10 MB × 5 |

Examples:

```bash
# Local readable
LOG_LEVEL=DEBUG LOG_FORMAT=text uvicorn app.main:app --app-dir backend --reload

# Docker / production style (compose sets these + mounts takeda_att_logs → /app/logs)
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_FILE=logs/app.log
```

## Error email alerts

Set `ERROR_ALERT_EMAILS=ops@example.com,dev@example.com` in `.env.docker` and restart the backend.

- Uses the SMTP settings from **Admin → Settings → Email delivery**, falling back to `SMTP_*` env. If the database is down, `SMTP_*` env is used so that outage still alerts — set `SMTP_*` in `.env.docker` for that case.
- Email contains environment, time, message, logger, source line, request ID, user ID, method/path, and the full traceback.
- Sent from a background thread; a slow SMTP server never delays the user's request.
- Same error (exception type + line) → one email per throttle window. Hard cap: 30 emails per hour per worker.
- If sending fails, a line `error_alert_not_sent: …` is written to stderr (`docker compose logs backend`).
- Covers backend errors only. Browser-side (React) errors are not sent to the backend.

## Reading logs

```bash
# Docker stdout
docker compose logs -f backend

# Durable file inside the backend container (survives recreate via takeda_att_logs volume)
docker compose exec backend tail -f logs/app.log

# One request end-to-end
docker compose logs backend | grep 'a1b2c3d4'

# One user (JSON)
docker compose logs backend | grep '"user_id": "42"'

# Physical order lifecycle
docker compose logs backend | grep physical_order_
```

## What is logged

| Area | Events |
|------|--------|
| HTTP | One access line per request (`method`, `path`, `status_code`, `duration_ms`) |
| Auth | `login_ok` / `login_failed`, refresh failures |
| SSO | `sso_login_started`, `sso_callback_ok` / `sso_callback_failed`, IdP errors |
| Physical orders | `physical_order_created`, `physical_order_assigned`, `physical_order_reassigned`, `physical_order_started`, `physical_order_scanned`, `physical_order_completed`, `physical_order_approved`, `physical_order_rejected`, `physical_order_items_rejected`, `physical_order_closed` |
| Errors | Unhandled exceptions with stack; validation failures |

**Never logged:** passwords, tokens, refresh cookies, IdP secrets.

## vs audit

| Technical logs | Audit tables |
|----------------|--------------|
| Debug failures & latency | Compliance / who changed what |
| stdout / `LOG_FILE` | Postgres + UI timelines |

## Self-check

```bash
PYTHONPATH=backend python -m core.logging_check
```
