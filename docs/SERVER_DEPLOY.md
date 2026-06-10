# Server deploy (Docker)

Use `docker-compose.yml` with `.env.docker` (copy from `.env.docker.example`).

## First deploy or update

```bash
cd /path/to/Takeda-ATT
git fetch origin
git checkout develop
git pull origin develop

cp -n .env.docker.example .env.docker   # skip if .env.docker already exists
# Edit .env.docker: JWT_SECRET_KEY, POSTGRES_PASSWORD, FRONTEND_APP_URL, APP_PORT, SMTP_*

chmod +x scripts/docker-deploy.sh
./scripts/docker-deploy.sh
```

Or run the steps manually:

```bash
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
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
| `SEED_SYSTEM_EMAIL_TEMPLATES` | Seed email templates during Alembic migrate |

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

# Rebuild after code pull
docker compose --env-file .env.docker up -d --build
```

## Local Docker (development)

Same `docker-compose.yml`; set in `.env.docker`:

```env
APP_HOST_BIND=0.0.0.0
FRONTEND_APP_URL=http://localhost:8083
FRONTEND_ORIGIN=http://localhost:8083
```

Then run `./scripts/docker-deploy.sh` and open `http://localhost:8083`.
