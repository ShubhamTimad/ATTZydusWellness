#!/usr/bin/env sh
# Build and start the full stack (db + backend + frontend).
#
# Server (production):
#   ./scripts/docker-deploy.sh
#
# Local development:
#   COMPOSE_FILE=docker-compose.yml ./scripts/docker-deploy.sh
#
# Optional env overrides:
#   ENV_FILE=.env.docker COMPOSE_FILE=docker-compose.server.yml ./scripts/docker-deploy.sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server.yml}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.docker.example and edit secrets:" >&2
  echo "  cp .env.docker.example .env.docker" >&2
  exit 1
fi

echo "==> Using compose file: $COMPOSE_FILE"
echo "==> Using env file:     $ENV_FILE"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo ""
echo "==> Service status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo ""
echo "==> Useful follow-ups"
echo "  Logs:       docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f backend"
echo "  Migrations: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE exec backend alembic -c backend/alembic.ini upgrade head"
echo "  Superuser:  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE exec backend python /app/create_superuser.py"
