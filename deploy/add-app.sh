#!/usr/bin/env bash
# Add a new app slot on the multi-app host (run ON the server from /opt/apps).
# Usage: ./add-app.sh <name> [internal_port]
set -euo pipefail

NAME="${1:-}"
PORT="${2:-4173}"
IP="$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"

if [[ -z "$NAME" ]]; then
  echo "Usage: $0 <app-name> [port]"
  exit 1
fi

if [[ -e "/opt/apps/$NAME" ]]; then
  echo "App directory already exists: /opt/apps/$NAME"
  exit 1
fi

mkdir -p "/opt/apps/$NAME"
cat > "/opt/apps/$NAME/.env.example" <<EOF
# Copy to .env and fill keys as needed
EOF

HOST="${NAME}.${IP}.sslip.io"

# Append compose service stub if missing
if ! grep -q "  ${NAME}:" /opt/apps/docker-compose.yml 2>/dev/null; then
  cat >> /opt/apps/docker-compose.yml <<EOF

  ${NAME}:
    build:
      context: ./${NAME}
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - ./${NAME}/.env
    expose:
      - "${PORT}"
EOF
fi

# Append Caddy site if missing
if ! grep -q "${HOST}" /opt/apps/Caddyfile 2>/dev/null; then
  cat >> /opt/apps/Caddyfile <<EOF

${HOST} {
	encode gzip
	reverse_proxy ${NAME}:${PORT}
}
EOF
fi

echo "Created /opt/apps/${NAME}"
echo "1. Copy your app (with Dockerfile) into /opt/apps/${NAME}"
echo "2. Add /opt/apps/${NAME}/.env"
echo "3. cd /opt/apps && docker compose up -d --build ${NAME}"
echo "4. Open http://${HOST}"
