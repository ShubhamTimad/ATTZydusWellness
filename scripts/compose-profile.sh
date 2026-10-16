#!/usr/bin/env sh
# Shared extra compose args from ENV_FILE:
#   DATABASE_URL set          → -f docker-compose.yml -f docker-compose.rds.yml (external DB, no db container)
#   ENABLE_EDGE_PROXY=true    → --profile https
# Usage:  EXTRA="$(./scripts/compose-profile.sh)"
#         docker compose --env-file "$ENV_FILE" $EXTRA up -d
#
set -eu
ENV_FILE="${1:-${ENV_FILE:-.env.docker}}"
[ -f "$ENV_FILE" ] || exit 0
ARGS=""
if grep -qE '^DATABASE_URL=.+' "$ENV_FILE"; then
  ARGS="-f docker-compose.yml -f docker-compose.rds.yml"
fi
if grep -qE '^ENABLE_EDGE_PROXY=(true|1|yes)$' "$ENV_FILE"; then
  ARGS="${ARGS:+$ARGS }--profile https"
fi
[ -z "$ARGS" ] || echo "$ARGS"
