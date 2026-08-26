#!/usr/bin/env sh
# Fast start/restart — no image rebuild (usually under 1 minute).
#
# Use after editing .env.docker (APP_HOST_BIND, URLs, SMTP, etc.) or a simple restart.
#
#   ./scripts/docker-up.sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — run: cp .env.docker.example .env.docker" >&2
  exit 1
fi

PROFILE="$(./scripts/compose-profile.sh "$ENV_FILE")"
# shellcheck disable=SC2086
compose() {
  docker compose --env-file "$ENV_FILE" $PROFILE "$@"
}

echo "==> Starting stack (no rebuild) using $ENV_FILE${PROFILE:+ ($PROFILE)}"
compose up -d

echo ""
compose ps
