# Server deploy (Docker)

Use `docker-compose.yml` with `.env.docker` (copy from `.env.docker.example`).

## URLs (what to open in the browser)

**With HTTPS** (recommended — see [HTTPS.md](./HTTPS.md)):

TLS on the **server’s existing reverse proxy** → `http://127.0.0.1:8083`.

| What | URL |
|------|-----|
| App | `https://assets.timadit.com` |
| Admin | `https://assets.timadit.com/admin/login` |
| API | `https://assets.timadit.com/api/...` |
| SSO callback (Entra) | `https://assets.timadit.com/api/auth/sso/callback` |

**Legacy direct port** (only if `APP_HOST_BIND=0.0.0.0` and no external proxy):

Replace `YOUR_SERVER_IP` with your VPS public IP (e.g. `161.97.93.106`).

| What | URL | Notes |
|------|-----|--------|
| **User / workspace login** | `http://YOUR_SERVER_IP:8083/login` | Main app entry |
| **Admin panel login** | `http://YOUR_SERVER_IP:8083/admin/login` | Superuser / admin UI |
| **Workspace home** | `http://YOUR_SERVER_IP:8083/dashboard` | After login |
| **API (via nginx)** | `http://YOUR_SERVER_IP:8083/api/...` | Used by the SPA automatically |

**Do not use port `9005` in the browser.** That is the backend port **inside Docker only**. With HTTPS, users open the domain; CI health-checks use loopback `APP_PORT` (default `8083`).

### If the page does not load from your PC

1. **Check core containers:**
   ```bash
   docker compose --env-file .env.docker ps
   ```
   Expect `frontend`, `backend`, and `db` healthy. Built-in `proxy` should **not** be running when `ENABLE_EDGE_PROXY=false`.

2. **HTTPS + external proxy** (default):
   ```env
   DOMAIN=assets.timadit.com
   ENABLE_EDGE_PROXY=false
   APP_HOST_BIND=127.0.0.1
   APP_PORT=8083
   ```
   External proxy must forward `assets.timadit.com` → `http://127.0.0.1:8083`. Direct public `:8083` will not work (loopback bind).

3. **Test on the server:**
   ```bash
   curl -I http://127.0.0.1:8083/
   curl -I https://assets.timadit.com/
   docker compose --env-file .env.docker logs --tail=50 frontend
   ```

4. **Firewall** — allow **80** and **443** on the **external** proxy (not ATT’s container ports).

5. **Public URLs** in `.env.docker`:
   ```env
   FRONTEND_ORIGIN=https://assets.timadit.com
   FRONTEND_APP_URL=https://assets.timadit.com
   FRONTEND_ADMIN_URL=https://assets.timadit.com/admin
   ```
   Then: `docker compose --env-file .env.docker up -d backend`

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
| `ENABLE_EDGE_PROXY` | `true` = start this repo’s proxy/certbot (`--profile https`). Default `false` (external TLS proxy) |
| `PROXY_HTTP_PORT` | Host HTTP port for built-in edge proxy (only if `ENABLE_EDGE_PROXY=true`) |
| `PROXY_HTTPS_PORT` | Host HTTPS port for built-in edge proxy (only if `ENABLE_EDGE_PROXY=true`) |
| `BACKEND_PORT` | Internal API port (default `9005`; must match nginx upstream build arg) |
| `VITE_API_URL` | Baked into frontend at build time (use `/api`) |
| `FRONTEND_APP_URL` / `FRONTEND_ORIGIN` | Public URL for reset links and CORS |
| `ENFORCE_SUPERUSER_ON_ADMIN` | `false` = RBAC; `true` = superuser-only `/admin/*` |
| `SYNC_MODULES_ON_STARTUP` | `true` — sync permission codes from app config (catalog only) |
| `SEED_SYSTEM_EMAIL_TEMPLATES` | `true` — ensure forgot-password / core email templates on start |
| `BOOTSTRAP_SUPERUSER_EMAIL` | First admin email (used only when no superuser exists) |
| `BOOTSTRAP_SUPERUSER_PASSWORD` | First admin password (change after first login) |

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

## Takeda servers: dev (HTTP) → prod (HTTPS)

Open inbound ports: **8069, 8090, 8091** (web), outbound SMTP **25 / 465 / 587**. Use **8090** for the app (8069 is Odoo's default — check it is free with `sudo ss -ltnp`). Backend port 9005 stays internal.

**Dev — plain HTTP, no SSO** (`.env.docker`):

```env
APP_HOST_BIND=0.0.0.0
APP_PORT=8090
FRONTEND_ORIGIN=http://SERVER:8090
FRONTEND_APP_URL=http://SERVER:8090
FRONTEND_ADMIN_URL=http://SERVER:8090/admin
SSO_ENABLED=false
```

**Prod — HTTPS terminated by Takeda's load balancer / reverse proxy** (corporate cert) forwarding to `SERVER:8090`. No code change; only these values change:

```env
FRONTEND_ORIGIN=https://APP_DOMAIN
FRONTEND_APP_URL=https://APP_DOMAIN
FRONTEND_ADMIN_URL=https://APP_DOMAIN/admin
SSO_ENABLED=true
SSO_REDIRECT_URI=https://APP_DOMAIN/api/auth/sso/callback
# Only the load balancer should reach :8090 — restrict it in the security group.
```

Ask Takeda IT for the load balancer to:
- forward `X-Forwarded-Proto: https` and `X-Forwarded-For` (frontend nginx passes them through to the API),
- allow request bodies up to 50 MB (asset imports / images) and a 300 s timeout (large exports),
- register `https://APP_DOMAIN/api/auth/sso/callback` as the redirect URI in the Entra app registration.

**SMTP** (from Takeda IT; set as `SMTP_*` in `.env.docker` so error alerts work even when the DB is down):

| Port | Settings |
|------|----------|
| 587 | `SMTP_USE_TLS=true` + username/password |
| 465 | implicit SSL, picked automatically by port |
| 25 | internal relay: `SMTP_USE_TLS=false`, usually no username/password |

Also confirm outbound access from the server to RDS on its port (5442).

## External database (AWS RDS)

Same branch, same images — only `.env.docker` on that server changes.

1. **Check the server can reach RDS** (security group must allow this server's IP):
   ```bash
   psql "host=RDS_HOST port=5442 dbname=DB_NAME user=APP_USER sslmode=require"
   ```
   A timeout here is a network/security-group problem, not an app problem.
2. **Use an app user, not the RDS master user.** It must own the database (migrations create tables); no extensions or superuser rights are needed.
3. **Set `DATABASE_URL`** in `.env.docker` (URL-encode the password; see `.env.docker.example`):
   ```env
   DATABASE_URL=postgresql+psycopg2://APP_USER:URL_ENCODED_PASSWORD@RDS_HOST:5442/DB_NAME?sslmode=require
   ```
   `POSTGRES_*` are then ignored.
4. **Start** with the usual scripts — they add `docker-compose.rds.yml` automatically when `DATABASE_URL` is set, so no `db` container starts:
   ```bash
   ./scripts/docker-rebuild.sh
   ```
   Manual equivalent:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker up -d --build
   ```
   Requires Docker Compose **2.24+** (`docker compose version`).
5. **Empty database:** the first backend start runs all migrations, seeds email templates, and creates the `BOOTSTRAP_SUPERUSER_*` admin. Watch it with `docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker logs -f backend`.

**Backups:** `scripts/backup-db.sh` only dumps the bundled container and refuses to run when `DATABASE_URL` is set. Use RDS automated backups (check the retention period) and take a manual snapshot before deploys that add migrations.

**Secret rotation:** if the password lives in AWS Secrets Manager with automatic rotation, new DB connections fail after each rotation until `.env.docker` is updated and the backend restarted — disable rotation for the app user or plan that restart.
## Local Docker (development)

Same `docker-compose.yml`; set in `.env.docker`:

```env
APP_HOST_BIND=0.0.0.0
FRONTEND_APP_URL=http://localhost:8083
FRONTEND_ORIGIN=http://localhost:8083
```

Then run `./scripts/docker-deploy.sh` and open `http://localhost:8083`.
