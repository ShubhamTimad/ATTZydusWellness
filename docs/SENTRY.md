# Sentry (error + performance monitoring)

Optional. Uses **Sentry cloud** (free Developer plan is enough). Active only when a DSN is set.
Complements technical logs ([LOGGING.md](./LOGGING.md)); does not replace them.

Your app URL (`http://SERVER_IP:8083` or a domain) is where users open the app.
The **DSN** is where the app sends errors — they are unrelated; no need to host Sentry yourself.

## Free plan (recommended start)

1. Sign up at [sentry.io](https://sentry.io) → **Developer** (free).
2. Create a project (platform **FastAPI** / Python). Optionally a second **React** project.
3. Copy the project **DSN**.
4. Keep `SENTRY_TRACES_SAMPLE_RATE=0.1` on the server so you stay within free quotas.
5. Alerts: Sentry → Alerts → email on new issues (Slack needs a paid plan).

## Docker / server (your production URL)

Edit `.env.docker` (never commit secrets):

```bash
# Backend → Sentry cloud
SENTRY_DSN=https://KEY@oORG.ingest.sentry.io/PROJECT
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
# Optional label in Sentry UI (e.g. hostname or app URL host)
# SENTRY_SERVER_NAME=att.example.com

# Frontend DSN (baked into the image at build — same DSN is fine on free tier)
VITE_SENTRY_DSN=https://KEY@oORG.ingest.sentry.io/PROJECT
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1

# One-time verify endpoint (set a long random string; unset after testing)
SENTRY_DEBUG_TOKEN=change-me-long-random
```

Also set your real public URLs (unchanged from deploy docs):

```bash
FRONTEND_ORIGIN=http://YOUR_SERVER_IP:8083
FRONTEND_APP_URL=http://YOUR_SERVER_IP:8083
FRONTEND_ADMIN_URL=http://YOUR_SERVER_IP:8083/admin
```

Deploy / rebuild (frontend must rebuild when `VITE_SENTRY_*` changes):

```bash
./scripts/docker-deploy.sh --build
# or
docker compose --env-file .env.docker up -d --build
```

Confirm backend picked up Sentry:

```bash
docker compose --env-file .env.docker logs backend | grep sentry_
# expect: sentry_configured
```

Probe (nginx mounts API at `/api`):

```bash
curl -sS "http://YOUR_SERVER_IP:8083/api/sentry-debug?token=YOUR_SENTRY_DEBUG_TOKEN"
```

You should get HTTP 500 and a new issue in Sentry (`environment:production`).
Then **clear `SENTRY_DEBUG_TOKEN`** (or leave unset) so the probe stays disabled.

## Local (uvicorn + Vite)

**Backend** — project root `.env`:

```bash
SENTRY_DSN=https://...
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=1.0
SENTRY_DEBUG_TOKEN=local-test-token
```

Restart API → log `sentry_configured` →  
`curl "http://localhost:8000/sentry-debug?token=local-test-token"`

**Frontend** — `frontend/.env.local`:

```bash
VITE_SENTRY_DSN=https://...
VITE_SENTRY_ENVIRONMENT=development
VITE_SENTRY_TRACES_SAMPLE_RATE=1.0
```

Restart `npm run dev`. In the browser console: `throw new Error('frontend sentry test')`.

## What is wired in code

| Piece | Location |
|-------|----------|
| Init + scrubbing | `backend/core/sentry_setup.py` |
| Tags `request_id` / `user_id` | `RequestLoggingMiddleware` |
| Capture 500s | `backend/app/main.py` exception handlers |
| Debug probe | `GET /sentry-debug` (token-gated) |
| Browser init | `frontend/src/lib/sentry.ts` |

## Suggested alerts (Sentry UI)

1. **Issues** — notify on new error / regression (email on free plan).
2. **Performance** — transaction p95 > 2–3s for critical routes.
3. Optional uptime monitor on your server URL.

## Privacy

- `send_default_pii=False`
- Authorization / Cookie filtered in `before_send`
- User identified by **id only**

## Self-check (no network)

```bash
PYTHONPATH=backend python -m core.sentry_check
```

## vs logs

| Logs | Sentry |
|------|--------|
| Full request story, grep by `request_id` | Notify on bugs / slowness |
| `docker compose logs` | sentry.io cloud |
