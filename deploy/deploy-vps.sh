#!/usr/bin/env bash
# Deploy Wikigraph (ontology) to the VPS.
#
# Usage:
#   ./deploy/deploy-vps.sh                 # bump patch, sync, rebuild
#   ./deploy/deploy-vps.sh --minor         # bump minor
#   ./deploy/deploy-vps.sh --major         # bump major
#   ./deploy/deploy-vps.sh --no-bump       # keep package.json version
#   ./deploy/deploy-vps.sh root@1.2.3.4
#   DEPLOY_HOST=1.2.3.4 ./deploy/deploy-vps.sh
#   npm run deploy
#
# Requires SSH access to the VPS (prefer SSH keys).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="ontology"
DEPLOY_HOST="${DEPLOY_HOST:-162.35.175.150}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE_APP="/opt/apps/${APP_NAME}"
REMOTE_COMPOSE="/opt/apps"
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

BUMP="patch"
for arg in "$@"; do
  case "$arg" in
    *@*) SSH_TARGET="$arg" ;;
    --major) BUMP="major" ;;
    --minor) BUMP="minor" ;;
    --patch) BUMP="patch" ;;
    --no-bump) BUMP="none" ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
  esac
done

current="$(node -p "require('./package.json').version")"
if [[ "$BUMP" != "none" ]]; then
  IFS=. read -r MAJOR MINOR PATCH <<<"$current"
  case "$BUMP" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
  esac
  next="${MAJOR}.${MINOR}.${PATCH}"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('package.json','utf8'));
    p.version = process.argv[1];
    fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  " "$next"
  version="$next"
  echo "Version: $current → $version"
else
  version="$current"
  echo "Version: $version (no bump)"
fi

released_at="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
released_local="$(date +"%Y-%m-%d %H:%M:%S %z")"

cat > src/release-info.ts <<EOF
/** Auto-updated by \`./deploy/deploy-vps.sh\` — do not edit by hand for production releases. */
export const RELEASE = {
  name: "${APP_NAME}",
  version: "${version}",
  /** ISO-8601 UTC (browser formats this to local time in the console) */
  releasedAt: "${released_at}",
  /** Stamp from the machine that ran the deploy script */
  releasedAtLocal: "${released_local}",
} as const;

export type ReleaseInfo = typeof RELEASE;
EOF

echo "Wrote src/release-info.ts ($version @ $released_local)"

echo "==> Syncing to ${SSH_TARGET}:${REMOTE_APP} ..."
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .cursor \
  --exclude 'agent-transcripts' \
  --exclude '.env' \
  ./ "${SSH_TARGET}:${REMOTE_APP}/"

if [[ -f .env ]]; then
  scp -q .env "${SSH_TARGET}:${REMOTE_APP}/.env"
  ssh "${SSH_TARGET}" "chmod 600 ${REMOTE_APP}/.env"
fi

# Keep platform routing in sync (Caddy / compose templates live in this repo)
scp -q deploy/Caddyfile "${SSH_TARGET}:${REMOTE_COMPOSE}/Caddyfile"
scp -q deploy/docker-compose.yml "${SSH_TARGET}:${REMOTE_COMPOSE}/docker-compose.yml"
scp -q deploy/add-app.sh "${SSH_TARGET}:${REMOTE_COMPOSE}/add-app.sh"
scp -q deploy/status.sh "${SSH_TARGET}:${REMOTE_COMPOSE}/status.sh"
ssh "${SSH_TARGET}" "chmod +x ${REMOTE_COMPOSE}/add-app.sh ${REMOTE_COMPOSE}/status.sh"

echo "==> Building & restarting ${APP_NAME} (+ redis cache) on server ..."
ssh "${SSH_TARGET}" "cd ${REMOTE_COMPOSE} && docker compose up -d --build redis ${APP_NAME} && docker compose up -d caddy"

echo ""
echo "Released ${APP_NAME} v${version}"
echo "  UTC:    ${released_at}"
echo "  Local:  ${released_local}"
echo "  URL:    http://${SSH_TARGET#*@}:4101/"
echo "  Open the site → browser console shows the same version stamp."
