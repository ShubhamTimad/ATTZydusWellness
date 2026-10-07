#!/bin/sh
set -eu

export PYTHONPATH="${PYTHONPATH:-/app/backend}"

echo "Waiting for database..."
attempt=0
until python -c "from sqlalchemy import create_engine, text; import os; engine = create_engine(os.environ['DATABASE_URL'], pool_pre_ping=True); conn = engine.connect(); conn.execute(text('SELECT 1')); conn.close()"; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        echo "Database did not become ready in time." >&2
        exit 1
    fi
    sleep 2
done

echo "Running database migrations..."
alembic -c backend/alembic.ini upgrade head

echo "Ensuring system email templates..."
python /app/scripts/ensure_system_email_templates.py

echo "Ensuring bootstrap superuser (only if none exists)..."
python /app/scripts/ensure_bootstrap_superuser.py

# Importing app.main runs the permission sync when SYNC_MODULES_ON_STARTUP is on.
# Do it once here; every uvicorn worker doing it races on inserts of new rows.
echo "Syncing permission catalog..."
python -c "import app.main"
export SYNC_MODULES_ON_STARTUP=false

mkdir -p /app/backend/uploads /app/logs
chown -R app:app /app/backend/uploads /app/logs

BACKEND_PORT="${BACKEND_PORT:-9005}"
ROOT_PATH="${ROOT_PATH:-}"
WORKERS="${UVICORN_WORKERS:-2}"
FORWARDED="${FORWARDED_ALLOW_IPS:-*}"
echo "Starting API on port ${BACKEND_PORT}${ROOT_PATH:+ (root_path=${ROOT_PATH})}..."
# --root-path makes Swagger UI request /api/openapi.json when nginx mounts the API at /api/
# --proxy-headers: trust X-Forwarded-For from the frontend nginx (backend is not published).
set -- uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --app-dir backend \
  --workers "${WORKERS}" --proxy-headers --forwarded-allow-ips "${FORWARDED}"
if [ -n "$ROOT_PATH" ]; then
  set -- "$@" --root-path "$ROOT_PATH"
fi
exec runuser -u app -- "$@"
