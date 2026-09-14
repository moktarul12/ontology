# Deploy / release (all from this repo)

## Release from your machine

```bash
cd /Users/moktarul/mywork/ontology
npm run release
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
npm run release -- --minor
npm run release -- --no-bump
DEPLOY_HOST=162.35.175.150 npm run release
```

Prefer SSH keys: `ssh-copy-id root@162.35.175.150`

## Live URL

https://ontology.162.35.175.150.sslip.io

## Multi-app on the server

```
/opt/apps/
  docker-compose.yml
  Caddyfile
  ontology/     # this project
  <other-app>/
```

```bash
ssh root@162.35.175.150
cd /opt/apps
./add-app.sh myapp
docker compose ps
docker compose restart ontology
```
