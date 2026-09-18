#!/bin/sh
# Same pattern as expomela: tiny wrapper, then exec the app CMD.
set -e
mkdir -p "${CACHE_DIR:-/app/.cache/ai}"
exec "$@"
