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

# HTTPS edge proxy (profile https) when DOMAIN is set in .env.docker.
compose() {
  if grep -qE '^DOMAIN=[^[:space:]#]+' "$ENV_FILE"; then
    docker compose --env-file "$ENV_FILE" --profile https "$@"
  else
    docker compose --env-file "$ENV_FILE" "$@"
  fi
}

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
    compose up -d --build "$SERVICE"
  else
    echo "==> Full rebuild (this can take several minutes)…"
    compose up -d --build
  fi
else
  echo "==> Fast start (no rebuild). Use --build after git pull."
  compose up -d
fi

echo ""
echo "==> Service status"
compose ps

DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'" || true)"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "==> App: https://${DOMAIN}/login"
  echo "    Loopback: http://127.0.0.1:\${APP_PORT:-8083}/login"
  echo "    First TLS cert (once): ./scripts/ssl-init.sh"
else
  echo "==> App: http://127.0.0.1:\${APP_PORT:-8083}/login"
fi
echo "    Logs: docker compose --env-file $ENV_FILE logs -f backend"
