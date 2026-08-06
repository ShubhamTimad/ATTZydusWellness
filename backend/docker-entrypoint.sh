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

BACKEND_PORT="${BACKEND_PORT:-9005}"
ROOT_PATH="${ROOT_PATH:-}"
echo "Starting API on port ${BACKEND_PORT}${ROOT_PATH:+ (root_path=${ROOT_PATH})}..."
# --root-path makes Swagger UI request /api/openapi.json when nginx mounts the API at /api/
if [ -n "$ROOT_PATH" ]; then
  exec uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --app-dir backend --root-path "$ROOT_PATH"
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --app-dir backend
