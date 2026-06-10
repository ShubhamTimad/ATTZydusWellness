# Server deploy (Docker)

Use `docker-compose.yml` with `.env.docker` (copy from `.env.docker.example`).

## URLs (what to open in the browser)

Replace `YOUR_SERVER_IP` with your VPS public IP (e.g. `161.97.93.106`) or domain.

| What | URL | Notes |
|------|-----|--------|
| **User / workspace login** | `http://YOUR_SERVER_IP:8083/login` | Main app entry |
| **Admin panel login** | `http://YOUR_SERVER_IP:8083/admin/login` | Superuser / admin UI |
| **Workspace home** | `http://YOUR_SERVER_IP:8083/dashboard` | After login |
| **API (via nginx)** | `http://YOUR_SERVER_IP:8083/api/...` | Used by the SPA automatically |

**Do not use port `9005` in the browser.** That is the backend port **inside Docker only** (not published to the host). The React app and `/api` proxy are on **`APP_PORT` (default `8083`)** via the **frontend** container.

### If the page does not load from your PC

1. **Check all containers are up:**
   ```bash
   docker compose --env-file .env.docker ps
   ```
   You should see `frontend`, `backend`, and `db` all **healthy** or **running**.

2. **Check bind address** in `.env.docker`:
   ```env
   APP_HOST_BIND=0.0.0.0
   APP_PORT=8083
   ```
   Default `APP_HOST_BIND=127.0.0.1` only allows access **from the server itself**, not from your laptop. Set `0.0.0.0` for direct public access, then:
   ```bash
   docker compose --env-file .env.docker up -d frontend
   ```

3. **Test on the server:**
   ```bash
   curl -I http://127.0.0.1:8083/
   curl -I http://127.0.0.1:8083/api/docs
   docker compose --env-file .env.docker logs --tail=50 frontend
   ```

4. **Firewall** — allow inbound TCP on `8083` (ufw / cloud security group).

5. **Set public URLs** in `.env.docker` (for CORS and password-reset links):
   ```env
   FRONTEND_ORIGIN=http://YOUR_SERVER_IP:8083
   FRONTEND_APP_URL=http://YOUR_SERVER_IP:8083
   FRONTEND_ADMIN_URL=http://YOUR_SERVER_IP:8083/admin
   ```
   Then restart backend: `docker compose --env-file .env.docker up -d backend`

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
2. Runs `alembic upgrade head` (all DB migrations)
3. Runs `scripts/ensure_system_email_templates.py` (idempotent FORGOT_PASSWORD templates)
4. Starts Uvicorn on `BACKEND_PORT` (default **9005**)

The frontend nginx container proxies `/api/*` to the backend and serves the React build on port **80** (mapped to `APP_PORT`, default **8083**).

## Environment variables (`.env.docker`)

| Variable | Purpose |
|----------|---------|
| `APP_PORT` | Host port for the web UI (default `8083`) |
| `APP_HOST_BIND` | Bind address (`127.0.0.1` behind reverse proxy, `0.0.0.0` for direct access) |
| `BACKEND_PORT` | Internal API port (default `9005`; must match nginx upstream build arg) |
| `VITE_API_URL` | Baked into frontend at build time (use `/api`) |
| `FRONTEND_APP_URL` / `FRONTEND_ORIGIN` | Public URL for reset links and CORS |
| `ENFORCE_SUPERUSER_ON_ADMIN` | `false` = RBAC; `true` = superuser-only `/admin/*` |
| `SYNC_MODULES_ON_STARTUP` | `false` (default) — no auto permission/feature sync on start; use Admin → Permissions → Sync |
| `SEED_SYSTEM_EMAIL_TEMPLATES` | `false` (default) — skip entrypoint email template script; set `true` on first deploy if needed |

## Permissions / email templates (manual, not automatic)

Production defaults **do not** auto-feed the database on every restart.

**Permissions catalog** (after upgrading app code with new modules):

```bash
docker compose --env-file .env.docker exec backend python /app/scripts/sync_modules.py
```

Or in the UI: **Admin → Permissions → Sync from config**.

**Email templates** (first deploy or forgot-password setup):

```env
SEED_SYSTEM_EMAIL_TEMPLATES=true
```

Then restart backend once, or run:

```bash
docker compose --env-file .env.docker exec backend python /app/scripts/ensure_system_email_templates.py
```

Do **not** run `scripts/seed_dummy_data.py` on production — that inserts demo plants, assets, and users.

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

# Create superuser
docker compose --env-file .env.docker exec backend \
  python /app/create_superuser.py

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
