#!/usr/bin/env sh
# Obtain the first Let's Encrypt certificate for DOMAIN (webroot via THIS repo's proxy).
#
# Prefer an external reverse proxy when host :80/:443 are already taken
# (ENABLE_EDGE_PROXY=false — see docs/HTTPS.md). Use this script only when
# ENABLE_EDGE_PROXY=true and PROXY_* ports are free.
#
# Prerequisites:
#   - DNS A record: DOMAIN → this server
#   - PROXY_HTTP_PORT / PROXY_HTTPS_PORT reachable and free
#   - ENABLE_EDGE_PROXY=true in .env.docker
#   - This script starts proxy/certbot via Compose profile "https"
#
# Usage (on the server):
#   ./scripts/ssl-init.sh
#   ./scripts/ssl-init.sh --force   # renew/replace existing cert
#
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# Read DOMAIN / CERTBOT_EMAIL without executing arbitrary shell from .env
DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")"
CERTBOT_EMAIL="$(grep -E '^CERTBOT_EMAIL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")"
set +a

DOMAIN="${DOMAIN:-assets.timadit.com}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

if ! grep -qE '^ENABLE_EDGE_PROXY=(true|1|yes)$' "$ENV_FILE"; then
  echo "ENABLE_EDGE_PROXY is not true in $ENV_FILE." >&2
  echo "Host :80/:443 should use your external reverse proxy → http://127.0.0.1:8083." >&2
  echo "See docs/HTTPS.md. Set ENABLE_EDGE_PROXY=true only to use this repo's proxy." >&2
  exit 1
fi

if [ -z "$CERTBOT_EMAIL" ]; then
  echo "Set CERTBOT_EMAIL in $ENV_FILE (Let's Encrypt registration)." >&2
  exit 1
fi

FORCE=""
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE="--force-renewal" ;;
  esac
done

COMPOSE="docker compose --env-file $ENV_FILE --profile https"

echo "==> Ensuring proxy / frontend / certbot are up"
$COMPOSE up -d frontend proxy certbot

echo "==> Waiting for proxy HTTP (container :80)"
i=0
until $COMPOSE exec -T proxy wget -q -O /dev/null http://127.0.0.1/ 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Proxy did not become ready." >&2
    exit 1
  fi
  sleep 2
done

echo "==> Requesting certificate for ${DOMAIN}"
# Run a one-off certbot using the same volumes as the renew service.
$COMPOSE run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  $FORCE

echo "==> Reloading proxy with HTTPS config"
$COMPOSE up -d --force-recreate proxy

echo ""
echo "==> Done. Verify:"
echo "    curl -I http://${DOMAIN}"
echo "    curl -I https://${DOMAIN}"
echo "    docker compose --env-file ${ENV_FILE} --profile https ps"
