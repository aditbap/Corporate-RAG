# Contributing

## Setup
```bash
nvm use                                   # Node 22 (.nvmrc)
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d
cp .env.example .env                      # then fill in provider keys
infra/keycloak/setup-realm.sh --dev-user  # local only
pnpm db:migrate && pnpm dev
```

## Before opening a PR
`pnpm typecheck && pnpm lint && pnpm test:unit` must pass (CI runs the same, plus builds the Docker images).
Integration tests (`pnpm --filter @rag/api test:integration`) need the local stack and Keycloak running.

## Conventions
- Database changes: `pnpm db:new <name>` creates a numbered SQL migration; migrations are forward-only and re-runnable.
- Keep commits focused; describe the *why* in the message.
- `scripts/ops` holds operational helpers, `scripts/dev` local-only helpers. Don't add one-off debug scripts to the repo.
