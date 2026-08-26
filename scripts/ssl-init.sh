#!/usr/bin/env sh
# Obtain the first Let's Encrypt certificate for DOMAIN (webroot via proxy).
#
# Prerequisites:
#   - DNS A record: DOMAIN → this server
#   - PROXY_HTTP_PORT (default 18080) and PROXY_HTTPS_PORT (default 443) reachable
#   - For Let's Encrypt HTTP-01: public :80 must reach this proxy (forward
#     host :80 → PROXY_HTTP_PORT if something else owns :80)
#   - Core stack running: docker compose --env-file .env.docker up -d
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

DOMAIN="${DOMAIN:-dev.adityatavnoji.in}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

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
