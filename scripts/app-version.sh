#!/usr/bin/env sh
# Prints the build version from ./VERSION exactly as written (e.g. 1.0.0). Change VERSION by hand for a new release.
set -eu
cd "$(dirname "$0")/.."
tr -d '[:space:]' < VERSION
echo
