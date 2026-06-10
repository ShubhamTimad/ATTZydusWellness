#!/usr/bin/env sh
# Build and start the full stack (db + backend + frontend).
#
#   ./scripts/docker-deploy.sh
#
# Optional:
#   ENV_FILE=.env.docker ./scripts/docker-deploy.sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.docker.example and edit secrets:" >&2
  echo "  cp .env.docker.example .env.docker" >&2
  exit 1
fi

echo "==> Using env file: $ENV_FILE"
echo "==> App URL: http://<your-server-ip>:${APP_PORT:-8083}/login (set APP_HOST_BIND=0.0.0.0 in $ENV_FILE for public access)"

docker compose --env-file "$ENV_FILE" up -d --build

echo ""
echo "==> Service status"
docker compose --env-file "$ENV_FILE" ps

echo ""
echo "==> Useful follow-ups"
echo "  Logs:       docker compose --env-file $ENV_FILE logs -f backend"
echo "  Migrations: docker compose --env-file $ENV_FILE exec backend alembic -c backend/alembic.ini upgrade head"
echo "  Superuser:  docker compose --env-file $ENV_FILE exec backend python /app/create_superuser.py"
