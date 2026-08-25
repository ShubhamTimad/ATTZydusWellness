# Technical application logs

Ops/debug logs for the API process. Separate from **business audit** (who changed an asset/order — already in DB).

## Design

- **One stream** for the whole app (stdout; optional single file). **Not** one file per user.
- Every line carries `request_id` and `user_id` (when known) so you can filter one flow end-to-end.
- Responses include `X-Request-ID` and JSON errors include `request_id`.

## Configuration

| Env | Default | Meaning |
|-----|---------|---------|
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `LOG_FORMAT` | `text` on TTY, else `json` | `json` or `text` |
| `LOG_FILE` | unset | Optional path; same events also go to stdout. Rotates at 10 MB × 5 |

Examples:

```bash
# Local readable
LOG_LEVEL=DEBUG LOG_FORMAT=text uvicorn app.main:app --app-dir backend --reload

# Docker / production style
LOG_LEVEL=INFO LOG_FORMAT=json
```

## Reading logs

```bash
# Docker
docker compose logs -f backend

# One request end-to-end
docker compose logs backend | grep 'a1b2c3d4'

# One user (JSON)
docker compose logs backend | grep '"user_id": "42"'
```

## What is logged

| Area | Events |
|------|--------|
| HTTP | One access line per request (`method`, `path`, `status_code`, `duration_ms`) |
| Auth | `login_ok` / `login_failed`, refresh failures |
| SSO | `sso_login_started`, `sso_callback_ok` / `sso_callback_failed`, IdP errors |
| Errors | Unhandled exceptions with stack; validation failures |

**Never logged:** passwords, tokens, refresh cookies, IdP secrets.

## vs audit

| Technical logs | Audit tables |
|----------------|--------------|
| Debug failures & latency | Compliance / who changed what |
| stdout / `LOG_FILE` | Postgres + UI timelines |

For cloud error alerts and slow-request notifications, see [SENTRY.md](./SENTRY.md).

## Self-check

```bash
PYTHONPATH=backend python -m core.logging_check
```
