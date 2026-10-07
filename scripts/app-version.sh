#!/usr/bin/env sh
# Prints the build version: MAJOR.MINOR from ./VERSION + PATCH = commits since VERSION last changed.
#   VERSION=1.0 committed → 1.0.0, next commits → 1.0.1, 1.0.2 …  Bump VERSION to 1.1 → 1.1.0.
set -eu
cd "$(dirname "$0")/.."
BASE="$(git log -1 --format=%H -- VERSION 2>/dev/null || true)"
PATCH="$([ -n "$BASE" ] && git rev-list --count "$BASE..HEAD" 2>/dev/null || echo 0)"
echo "$(tr -d '[:space:]' < VERSION).$PATCH"
