# Deploy / release (all from this repo)

## Deploy from your machine

Same command as ManavSathi and Expo Mela:

```bash
cd /Users/moktarul/mywork/ontology
./deploy/deploy-vps.sh
# or: npm run deploy
```

What it does:
1. Bumps `package.json` patch version (use `--minor` / `--major` / `--no-bump`)
2. Writes `src/release-info.ts` with version + date-time
3. `rsync` this folder → `/opt/apps/ontology` on the VPS
4. `docker compose up -d --build ontology` (Redis cache service included)

### Cache (local + server)

AI timeline / enrich responses are cached:

| Layer | Local `yarn dev` | Server (compose) |
|---|---|---|
| Memory | yes | yes |
| Disk (`.cache/ai`) | yes | volume `ontology_cache` |
| Redis | optional `REDIS_URL` | `redis` service |

Check: `GET /api/ai/status` → `cache.redis`, `cache.diskDir`.

```bash
# Local with Redis (optional)
docker run -d --name ontology-redis -p 6379:6379 redis:7-alpine
echo 'REDIS_URL=redis://127.0.0.1:6379' >> .env
```

After load, browser console shows:
`[ontology] v0.0.2 · last release 2026-09-13 21:57:00 +0530 (...)`

```bash
./deploy/deploy-vps.sh --minor
./deploy/deploy-vps.sh --no-bump
DEPLOY_HOST=162.35.175.150 ./deploy/deploy-vps.sh
```

`npm run release` is an alias for the same script.

Prefer SSH keys: `ssh-copy-id root@162.35.175.150`

## Live URL

https://ontology.162.35.175.150.sslip.io

**Port URLs (reliable while HTTPS/Caddy conflicts with nginx):** see full multi-app ops doc:

`/Users/moktarul/mywork/VPS-OPS.md`

| App | URL |
|---|---|
| ManavSathi | http://162.35.175.150:4100/ |
| Wikigraph | http://162.35.175.150:4101/ |
| Stall booking | http://162.35.175.150:4102/ |

All three are Docker Compose services on `/opt/apps`. Host nginx only proxies `manavsathi.com` → `:4100`.

## Multi-app on the server

```
/opt/apps/
  docker-compose.yml
  Caddyfile
  manavsathi/   # Expo web + nginx image
  ontology/     # this project
  expomela/
```

```bash
ssh root@162.35.175.150
cd /opt/apps
./add-app.sh myapp
docker compose ps
docker compose restart ontology
```
