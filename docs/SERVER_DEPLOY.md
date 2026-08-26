# Server deploy (Docker)

Use `docker-compose.yml` with `.env.docker` (copy from `.env.docker.example`).

## URLs (what to open in the browser)

**With HTTPS** (recommended — see [HTTPS.md](./HTTPS.md)):

| What | URL |
|------|-----|
| App | `https://assets.timadit.com` |
| Admin | `https://assets.timadit.com/admin/login` |
| API | `https://assets.timadit.com/api/...` |
| SSO callback (Entra) | `https://assets.timadit.com/api/auth/sso/callback` |

**Legacy direct port** (only if edge proxy is stopped and `APP_HOST_BIND=0.0.0.0`):

Replace `YOUR_SERVER_IP` with your VPS public IP (e.g. `161.97.93.106`).

| What | URL | Notes |
|------|-----|--------|
| **User / workspace login** | `http://YOUR_SERVER_IP:8083/login` | Main app entry |
| **Admin panel login** | `http://YOUR_SERVER_IP:8083/admin/login` | Superuser / admin UI |
| **Workspace home** | `http://YOUR_SERVER_IP:8083/dashboard` | After login |
| **API (via nginx)** | `http://YOUR_SERVER_IP:8083/api/...` | Used by the SPA automatically |

**Do not use port `9005` in the browser.** That is the backend port **inside Docker only** (not published to the host). With HTTPS, users open the domain; CI health-checks still use loopback `APP_PORT` (default `8083`).

### If the page does not load from your PC

1. **Check all containers are up:**
   ```bash
   docker compose --env-file .env.docker --profile https ps
   ```
   You should see `frontend`, `backend`, `db`, and (for HTTPS) `proxy` / `certbot` **healthy** or **running**.

2. **HTTPS mode** (default) — frontend is loopback-only; public traffic hits proxy `:80`/`:443`:
   ```env
   DOMAIN=assets.timadit.com
   APP_HOST_BIND=127.0.0.1
   APP_PORT=8083
   PROXY_HTTP_PORT=80
   PROXY_HTTPS_PORT=443
   ```
   Direct IP:8083 from the internet will not work (by design). Use `https://assets.timadit.com`.

3. **Test on the server:**
   ```bash
   curl -I http://127.0.0.1:8083/
   curl -I https://assets.timadit.com/
   docker compose --env-file .env.docker --profile https logs --tail=50 frontend proxy
   ```

4. **Firewall** — allow inbound TCP **80** and **443** (and **8083** only if using HTTP IP fallback).

5. **Set public URLs** in `.env.docker` (for CORS and password-reset links):
   ```env
   FRONTEND_ORIGIN=https://assets.timadit.com
   FRONTEND_APP_URL=https://assets.timadit.com
   FRONTEND_ADMIN_URL=https://assets.timadit.com/admin
   ```
   Then restart backend: `docker compose --env-file .env.docker --profile https up -d backend`

## First deploy or update

```bash
cd /path/to/Takeda-ATT
git fetch origin
git checkout develop
git pull origin develop

cp -n .env.docker.example .env.docker   # skip if .env.docker already exists
# Edit .env.docker: JWT_SECRET_KEY, POSTGRES_PASSWORD, FRONTEND_APP_URL, APP_PORT, SMTP_*

chmod +x scripts/docker-*.sh
./scripts/docker-rebuild.sh    # first time only — builds images (slow)
```

### Fast vs slow commands

| When | Command | Time |
|------|---------|------|
| **First deploy** or **after `git pull`** (code changed) | `./scripts/docker-rebuild.sh` | Several minutes |
| **Backend code only** changed | `./scripts/docker-rebuild.sh backend` | ~2–5 min |
| **Frontend code only** changed | `./scripts/docker-rebuild.sh frontend` | ~3–8 min (npm build) |
| **Only `.env.docker` changed** (bind IP, URLs, SMTP) | `./scripts/docker-up.sh` | ~30 seconds |
| **Simple restart** | `./scripts/docker-up.sh` | ~30 seconds |

**Do not use `--build` every time** — it re-runs `npm ci` + `vite build` and `pip install`, which is slow.

```bash
# Fast — env change or restart (no rebuild)
docker compose --env-file .env.docker up -d

# Slow — only after git pull / code change
docker compose --env-file .env.docker up -d --build
```

**Always** include `--env-file .env.docker`; otherwise Compose falls back to defaults for DB password, `DATABASE_URL`, app URLs, and ports.

### What starts automatically

On backend container start (`backend/docker-entrypoint.sh`):

1. Waits for PostgreSQL
2. Runs `alembic upgrade head` (schema migrations only — no demo assets/users)
3. Ensures system email templates (`ensure_system_email_templates.py`)
4. Creates bootstrap superuser **only if none exists** (`ensure_bootstrap_superuser.py`)
5. On API start: syncs permission/feature **catalog** from config when `SYNC_MODULES_ON_STARTUP=true` (not demo data)
6. Starts Uvicorn on `BACKEND_PORT` (default **9005**)

The frontend nginx container proxies `/api/*` to the backend and serves the React build on port **80** (mapped to `APP_PORT`, default **8083**).

## Environment variables (`.env.docker`)

| Variable | Purpose |
|----------|---------|
| `APP_PORT` | Host port for the web UI (default `8083`) |
| `APP_HOST_BIND` | Bind address (`127.0.0.1` behind reverse proxy, `0.0.0.0` for direct access) |
| `PROXY_HTTP_PORT` | Host port for edge proxy HTTP (default `80`; with `--profile https`) |
| `PROXY_HTTPS_PORT` | Host port for edge proxy HTTPS (default `443`; with `--profile https`) |
| `BACKEND_PORT` | Internal API port (default `9005`; must match nginx upstream build arg) |
| `VITE_API_URL` | Baked into frontend at build time (use `/api`) |
| `FRONTEND_APP_URL` / `FRONTEND_ORIGIN` | Public URL for reset links and CORS |
| `ENFORCE_SUPERUSER_ON_ADMIN` | `false` = RBAC; `true` = superuser-only `/admin/*` |
| `SYNC_MODULES_ON_STARTUP` | `true` — sync permission codes from app config (catalog only) |
| `SEED_SYSTEM_EMAIL_TEMPLATES` | `true` — ensure forgot-password / core email templates on start |
| `BOOTSTRAP_SUPERUSER_EMAIL` | First admin email (used only when no superuser exists) |
| `BOOTSTRAP_SUPERUSER_PASSWORD` | First admin password (change after first login) |
| `SENTRY_DSN` | Sentry project DSN (empty = disabled). See [SENTRY.md](./SENTRY.md) |
| `SENTRY_ENVIRONMENT` | Usually `production` on the VPS |
| `VITE_SENTRY_DSN` | Browser SDK DSN (baked at frontend image build; can match `SENTRY_DSN`) |

## Sentry (optional)

1. Set `SENTRY_DSN` / `VITE_SENTRY_DSN` in `.env.docker` (never commit; never put the DSN in a Dockerfile).
2. Use `SENTRY_ENVIRONMENT=production` and `SENTRY_TRACES_SAMPLE_RATE=0.1` on the server.
3. Rebuild so the frontend picks up `VITE_*`:

```bash
./scripts/docker-deploy.sh --build
docker compose --env-file .env.docker logs backend | grep sentry_
```

Full steps: [SENTRY.md](./SENTRY.md).

Do **not** run these on production — they insert demo plants, assets, orders, and users:

- `scripts/seed_dummy_data.py`
- `scripts/seed_manual_test_users.py`
- `scripts/seed_fy_verification_demo.py`
- `scripts/seed_physical_order_states.py`

**Manual permission sync** (optional, same as startup sync):

```bash
docker compose --env-file .env.docker exec backend python /app/scripts/sync_modules.py
```

Or **Admin → Permissions → Sync from config**.

## Fix “Password reset email is not configured”

1. **Templates** — should exist after restart; or run manually:
   ```bash
   docker compose --env-file .env.docker exec backend \
     python /app/scripts/ensure_system_email_templates.py
   ```
2. **SMTP** — in `.env.docker` set `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and ensure `SEED_SYSTEM_EMAIL_TEMPLATES=true`, **or** configure **Admin → Settings → Email delivery** (DB overrides env when saved).
3. **Reset link URL** — set `FRONTEND_APP_URL` (and `FRONTEND_ORIGIN`) to your real app URL, then restart backend:
   ```bash
   docker compose --env-file .env.docker up -d backend
   ```

## Fix 403 on `/api/admin/*` for non-superuser roles

Set in `.env.docker`:

```env
ENFORCE_SUPERUSER_ON_ADMIN=false
```

Then restart the backend. Grant the role permissions such as `asset.view`, `masters.view`, `org_units.view` as needed.

## Useful commands

```bash
# Logs
docker compose --env-file .env.docker logs -f backend

# DB migrations only (normally automatic on start)
docker compose --env-file .env.docker exec backend \
  alembic -c backend/alembic.ini upgrade head

# Create another superuser manually
docker compose --env-file .env.docker exec backend \
  python /app/create_superuser.py --email admin@example.com --password 'ChangeMe@123'

# Rebuild after code pull (slow)
./scripts/docker-rebuild.sh

# Fast restart only
./scripts/docker-up.sh
```

## Local Docker (development)

Same `docker-compose.yml`; set in `.env.docker`:

```env
APP_HOST_BIND=0.0.0.0
FRONTEND_APP_URL=http://localhost:8083
FRONTEND_ORIGIN=http://localhost:8083
```

Then run `./scripts/docker-deploy.sh` and open `http://localhost:8083`.
