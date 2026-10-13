# Production deploy (single server, Docker Compose)

Stack: Caddy (auto-HTTPS) → web / api / keycloak; worker, prometheus, grafana (SSH tunnel to 127.0.0.1:3003 only), postgres(pgvector), redis, minio, ocr, clamav stay internal.

## Prerequisites
- Linux server with Docker + Compose v2, ~8 GB RAM (OCR 2g, ClamAV 2g, Keycloak 1g), ports 80/443 open.
- Three DNS A records → server IP: `APP_DOMAIN`, `API_DOMAIN`, `AUTH_DOMAIN`.
- API keys: NVIDIA (embeddings), Cloudflare (LLM); optional Gemini, Cohere.

## First deploy
```bash
cp .env.production.example .env.production      # fill in; generate secrets with: openssl rand -hex 24
DC="docker compose --env-file .env.production -f infra/docker/docker-compose.deploy.yml"

$DC up -d postgres keycloak                       # Keycloak needs its realm before web can log anyone in
KEYCLOAK_CONTAINER=$($DC ps -q keycloak) \
KEYCLOAK_ADMIN_PASSWORD=<same as .env.production> \
WEB_URL=https://<APP_DOMAIN> KEYCLOAK_PUBLIC_URL=https://<AUTH_DOMAIN> \
ENV_FILE=.env.production infra/keycloak/setup-realm.sh   # writes AUTH_KEYCLOAK_SECRET (+ AUTH_SECRET if empty)

$DC up -d --build                                 # runs migrations, then api/worker/web/caddy
$DC ps && curl -fsS https://<API_DOMAIN>/health
```
Create real users in the Keycloak admin console (`https://<AUTH_DOMAIN>`); do NOT use `--dev-user`.

## Update
`git pull && $DC up -d --build` (migrations run automatically; they are forward-only).
Changing `API_DOMAIN` requires rebuilding `web` (the URL is baked into the browser bundle).

## Backups
Volumes to snapshot: `rag_postgres_data` (also holds Keycloak's DB), `rag_minio_data`.
Example: `$DC exec -T postgres pg_dumpall -U postgres | gzip > backup-$(date +%F).sql.gz`
