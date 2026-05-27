# Server deploy (Docker)

Use `docker-compose.server.yml` on the host. Copy `.env.docker.example` to `.env.docker` and set secrets plus your public URL.

## First deploy or update

```bash
cd /path/to/Takeda-ATT
git fetch origin
git checkout docker-setup-updates
git pull origin docker-setup-updates

cp -n .env.docker.example .env.docker   # skip if .env.docker already exists
# Edit .env.docker: JWT_SECRET_KEY, POSTGRES_PASSWORD, FRONTEND_APP_URL, SMTP_* 

docker compose -f docker-compose.server.yml build
docker compose -f docker-compose.server.yml up -d
```

Migrations and **FORGOT_PASSWORD** template mappings run automatically on backend start (`ensure_system_email_templates.py`).

## Fix “Password reset email is not configured”

1. **Templates** — should exist after restart; or run manually:
   ```bash
   docker compose -f docker-compose.server.yml exec backend python /app/scripts/ensure_system_email_templates.py
   ```
2. **SMTP** — in `.env.docker` set `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and ensure `SEED_SYSTEM_EMAIL_TEMPLATES=true`, **or** configure **Admin → Settings → Email delivery** (DB overrides env when saved).
3. **Reset link URL** — set `FRONTEND_APP_URL` (and `FRONTEND_ORIGIN`) to your real app URL, then restart backend:
   ```bash
   docker compose -f docker-compose.server.yml up -d backend
   ```

## Useful commands

```bash
# Logs
docker compose -f docker-compose.server.yml logs -f backend

# DB migrations only (normally automatic on start)
docker compose -f docker-compose.server.yml exec backend alembic -c backend/alembic.ini upgrade head

# Create superuser
docker compose -f docker-compose.server.yml exec backend python /app/create_superuser.py
```
