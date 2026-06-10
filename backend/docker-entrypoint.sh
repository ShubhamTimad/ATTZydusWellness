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

BACKEND_PORT="${BACKEND_PORT:-9005}"
echo "Starting API on port ${BACKEND_PORT}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --app-dir backend
