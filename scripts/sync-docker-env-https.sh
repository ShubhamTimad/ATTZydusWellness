#!/usr/bin/env sh
# Upsert public-URL / bind keys from .env.docker.example into .env.docker
# without wiping secrets (JWT, DB password, Sentry DSN, SMTP, etc.).
#
# Syncs only *active* (uncommented) keys from the example — so with the default
# HTTPS block active, this applies assets.timadit.com URLs. For HTTP IP fallback,
# comment DOMAIN / HTTPS FRONTEND_* in the example and uncomment block B, then re-run.
#
#   ./scripts/sync-docker-env-https.sh
#
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXAMPLE="${ENV_EXAMPLE:-.env.docker.example}"
TARGET="${ENV_FILE:-.env.docker}"

if [ ! -f "$EXAMPLE" ]; then
  echo "Missing $EXAMPLE" >&2
  exit 1
fi

if [ ! -f "$TARGET" ]; then
  echo "No $TARGET — copying from $EXAMPLE"
  cp "$EXAMPLE" "$TARGET"
  echo "Created $TARGET — edit JWT_SECRET_KEY / POSTGRES_PASSWORD before starting."
  exit 0
fi

# Keys that should follow the committed example when present as active lines.
KEYS="
APP_HOST_BIND
APP_PORT
BACKEND_PORT
VITE_API_URL
ROOT_PATH
DOMAIN
CERTBOT_EMAIL
PROXY_HTTP_PORT
PROXY_HTTPS_PORT
FRONTEND_ORIGIN
FRONTEND_APP_URL
FRONTEND_ADMIN_URL
SSO_REDIRECT_URI
SENTRY_SERVER_NAME
SENTRY_ENVIRONMENT
VITE_SENTRY_ENVIRONMENT
"

tmp="$(mktemp)"
cp "$TARGET" "$tmp"

upsert() {
  key="$1"
  val="$2"
  if grep -qE "^${key}=" "$tmp"; then
    awk -v k="$key" -v v="$val" '
      BEGIN { done=0 }
      $0 ~ ("^" k "=") && !done { print k "=" v; done=1; next }
      { print }
    ' "$tmp" > "${tmp}.new"
    mv "${tmp}.new" "$tmp"
  else
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
}

echo "==> Syncing active keys from $EXAMPLE → $TARGET"
for key in $KEYS; do
  line="$(grep -E "^${key}=" "$EXAMPLE" | tail -1 || true)"
  if [ -z "$line" ]; then
    continue
  fi
  val="${line#*=}"
  upsert "$key" "$val"
  echo "  set ${key}=${val}"
done

mv "$tmp" "$TARGET"
echo ""
echo "==> Updated $TARGET (secrets preserved)."
echo "    docker compose --env-file $TARGET --profile https up -d"
echo "    # First TLS cert (once): ./scripts/ssl-init.sh"
