#!/usr/bin/env bash
# Release ontology to the VPS from this repo folder.
#
# Usage:
#   npm run release              # bump patch (0.0.1 → 0.0.2), sync, rebuild
#   npm run release -- --minor   # bump minor
#   npm run release -- --major   # bump major
#   npm run release -- --no-bump # keep package.json version
#   DEPLOY_HOST=1.2.3.4 npm run release
#
# Requires SSH access to root@$DEPLOY_HOST (prefer SSH keys).
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
/** Auto-updated by \`npm run release\` — do not edit by hand for production releases. */
export const RELEASE = {
  name: "${APP_NAME}",
  version: "${version}",
  /** ISO-8601 UTC (browser formats this to local time in the console) */
  releasedAt: "${released_at}",
  /** Stamp from the machine that ran \`npm run release\` */
  releasedAtLocal: "${released_local}",
} as const;

export type ReleaseInfo = typeof RELEASE;
EOF

echo "Wrote src/release-info.ts ($version @ $released_local)"

echo "Syncing to ${SSH_TARGET}:${REMOTE_APP} ..."
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
ssh "${SSH_TARGET}" "chmod +x ${REMOTE_COMPOSE}/add-app.sh"

echo "Building & restarting ${APP_NAME} (+ redis cache) on server ..."
ssh "${SSH_TARGET}" "cd ${REMOTE_COMPOSE} && docker compose up -d --build redis ${APP_NAME} && docker compose up -d caddy"

echo ""
echo "Released ${APP_NAME} v${version}"
echo "  UTC:    ${released_at}"
echo "  Local:  ${released_local}"
echo "  URL:    https://ontology.${DEPLOY_HOST}.sslip.io"
echo "  Open the site → browser console shows the same version stamp."
