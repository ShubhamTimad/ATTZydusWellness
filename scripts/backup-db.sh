#!/bin/sh
# Dump the Compose Postgres database and keep the newest 14 files.
# Cron: 0 2 * * * cd /path/to/Takeda-ATT && ./scripts/backup-db.sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.docker}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if grep -qE '^DATABASE_URL=.+' "$ENV_FILE"; then
  echo "External database (DATABASE_URL set): there is no db container to dump." >&2
  echo "Use RDS automated backups / manual snapshots instead." >&2
  exit 1
fi

POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")"
POSTGRES_USER="${POSTGRES_USER:-takeda}"
POSTGRES_DB="${POSTGRES_DB:-takeda_att}"

mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/takeda_att_${STAMP}.dump"

docker compose --env-file "$ENV_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$OUT"

echo "Wrote $OUT"
# Keep 14 newest dumps.
# shellcheck disable=SC2012
ls -1t backups/takeda_att_*.dump 2>/dev/null | tail -n +15 | while read -r old; do
  rm -f "$old"
done
