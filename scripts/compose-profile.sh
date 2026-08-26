#!/usr/bin/env sh
# Shared: echo "--profile https" when ENABLE_EDGE_PROXY=true in ENV_FILE.
# Usage:  EXTRA="$(./scripts/compose-profile.sh)" 
#         docker compose --env-file "$ENV_FILE" $EXTRA up -d
#
set -eu
ENV_FILE="${1:-${ENV_FILE:-.env.docker}}"
if [ -f "$ENV_FILE" ] && grep -qE '^ENABLE_EDGE_PROXY=(true|1|yes)$' "$ENV_FILE"; then
  echo "--profile https"
fi
