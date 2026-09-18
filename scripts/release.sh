#!/usr/bin/env bash
# Back-compat wrapper. Canonical command: ./deploy/deploy-vps.sh
set -euo pipefail
exec "$(cd "$(dirname "$0")/.." && pwd)/deploy/deploy-vps.sh" "$@"
