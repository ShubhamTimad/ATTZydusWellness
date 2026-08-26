#!/usr/bin/env sh
# Rebuild images after git pull / code changes.
#
#   ./scripts/docker-rebuild.sh              # rebuild all (slow — frontend npm build)
#   ./scripts/docker-rebuild.sh backend      # backend only (~2–5 min)
#   ./scripts/docker-rebuild.sh frontend     # frontend only (slowest)
#
# For .env.docker changes only, use ./scripts/docker-up.sh instead (seconds).

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"
SERVICE="${1:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — run: cp .env.docker.example .env.docker" >&2
  exit 1
fi

compose() {
  if grep -qE '^DOMAIN=[^[:space:]#]+' "$ENV_FILE"; then
    docker compose --env-file "$ENV_FILE" --profile https "$@"
  else
    docker compose --env-file "$ENV_FILE" "$@"
  fi
}

if [ -n "$SERVICE" ]; then
  echo "==> Rebuilding and starting: $SERVICE"
  compose up -d --build "$SERVICE"
else
  echo "==> Rebuilding and starting all services"
  compose up -d --build
fi

echo ""
compose ps
