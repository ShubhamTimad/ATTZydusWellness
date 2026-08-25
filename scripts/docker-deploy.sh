#!/usr/bin/env sh
# Deploy helper — defaults to FAST restart (no rebuild).
#
#   ./scripts/docker-deploy.sh           # fast: up -d only (~30s)
#   ./scripts/docker-deploy.sh --build   # full rebuild after git pull (slow)
#   ./scripts/docker-deploy.sh backend   # rebuild one service
#
# See also: docker-up.sh, docker-rebuild.sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.docker.example and edit secrets:" >&2
  echo "  cp .env.docker.example .env.docker" >&2
  exit 1
fi

BUILD=0
SERVICE=""
for arg in "$@"; do
  case "$arg" in
    --build|-b) BUILD=1 ;;
    backend|frontend|db) SERVICE="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Using env file: $ENV_FILE"

if [ "$BUILD" -eq 1 ]; then
  if [ -n "$SERVICE" ]; then
    echo "==> Rebuilding: $SERVICE"
    docker compose --env-file "$ENV_FILE" up -d --build "$SERVICE"
  else
    echo "==> Full rebuild (this can take several minutes)…"
    docker compose --env-file "$ENV_FILE" up -d --build
  fi
else
  echo "==> Fast start (no rebuild). Use --build after git pull."
  docker compose --env-file "$ENV_FILE" up -d
fi

echo ""
echo "==> Service status"
docker compose --env-file "$ENV_FILE" ps

echo ""
echo "==> App (HTTPS): https://\${DOMAIN:-dev.adityatavnoji.in}/login"
echo "    Direct (loopback): http://127.0.0.1:\${APP_PORT:-8083}/login"
echo "    Logs: docker compose --env-file $ENV_FILE logs -f backend"
echo "    TLS setup: docs/HTTPS.md  (./scripts/ssl-init.sh)"
