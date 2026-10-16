# Technical application logs

Ops/debug logs for the API process. Separate from **business audit** (who changed an asset/order — already in DB).

## Design

- **One stream** for the whole app on stdout, plus daily files split by concern (below). **Not** one file per user or module.
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
| `LOG_DIR` | unset locally (stdout only); `/app/logs` in Docker | Directory for the daily files below. stdout stays on either way |
| `LOG_RETENTION_DAYS` | `30` | Daily files older than this are deleted (at startup and at each UTC day change) |
| `LOG_HOST_DIR` | `./logs` (next to `docker-compose.yml`) | Docker only: server folder mounted at `/app/logs`, e.g. `/var/log/takeda-att` |

Examples:

```bash
# Local readable
LOG_LEVEL=DEBUG LOG_FORMAT=text uvicorn app.main:app --app-dir backend --reload

# Local with files
LOG_DIR=logs uvicorn app.main:app --app-dir backend --reload
```

## Log files

```text
<LOG_HOST_DIR>/              (= /app/logs inside the backend container)
├── all/     all-YYYY-MM-DD.log      # end-to-end: every line from every logger
├── access/  access-YYYY-MM-DD.log   # one line per HTTP request (logger app.access)
├── error/   error-YYYY-MM-DD.log    # WARNING and above from every logger
└── auth/    auth-YYYY-MM-DD.log     # login, refresh, SSO, captcha (modules.platform.auth.*, core.captcha)
```

- Dates are UTC. A new file starts at UTC midnight; files are never renamed, so all uvicorn workers append safely to the same file.
- Lines in `access/`, `error/` and `auth/` are also in `all/`.
- The folder is a bind mount on the server, so logs survive container/image removal, `docker compose down -v`, and Docker being stopped (read them straight from disk).
- Docker's own stdout copy (`docker compose logs`) is capped at 5 × 20 MB per container.
- Successful health checks are not logged (`/health` → DEBUG). A failing health check is logged as WARNING/ERROR and lands in `error/`. The frontend nginx does not log its own container health check either.

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

# Files on the server (default ./logs next to docker-compose.yml, or LOG_HOST_DIR)
tail -f logs/error/error-$(date -u +%F).log
tail -f logs/all/all-$(date -u +%F).log

# One request end-to-end
grep -h 'a1b2c3d4' logs/all/all-*.log

# One user (JSON)
grep -h '"user_id": "42"' logs/all/all-$(date -u +%F).log

# Failed logins today
grep -h login_failed logs/auth/auth-$(date -u +%F).log

# Physical order lifecycle
grep -h physical_order_ logs/all/all-*.log
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
| stdout / `LOG_DIR` files | Postgres + UI timelines |

## Self-check

```bash
PYTHONPATH=backend python -m core.logging_check
pytest -q tests/test_log_files.py
```
