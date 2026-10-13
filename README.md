# RAG Platform

Multi-tenant document Q&A: upload documents into shared libraries, then chat with them and get
answers with citations. Retrieval uses PostgreSQL (pgvector embeddings + BM25 full-text) followed by
an optional reranker; documents are virus-scanned, OCR'd when needed, chunked and embedded
asynchronously.

## Architecture

```
Browser ──► Caddy (HTTPS) ─┬─► web      Next.js 16 + Auth.js (Keycloak OIDC)
                           ├─► api      Fastify: libraries, documents, chat (SSE), RBAC, rate limits
                           └─► keycloak identity provider

api ──► postgres (pgvector) · redis (BullMQ) · minio (S3 objects) · LLM / embedding / rerank providers
worker ◄─ redis queue ─ ingestion: ClamAV scan → OCR sidecar → chunk → embed → postgres
prometheus ◄─ api:9100/metrics ─► grafana
```

| Path | Purpose |
|---|---|
| `apps/api` | HTTP API (Fastify) |
| `apps/worker` | Document ingestion worker (BullMQ) |
| `apps/web` | Web UI (Next.js) |
| `packages/core` | Shared interfaces, production config checks |
| `packages/database` | Drizzle schema, repositories, SQL migrations + runner |
| `packages/providers` | LLM, embedding, reranker, storage (MinIO), ClamAV adapters |
| `packages/auth` | Role-based access control |
| `infra/docker` | Dev compose, production compose, Dockerfiles |
| `infra/deploy` | Caddyfile, Prometheus config, deploy guide |
| `infra/keycloak`, `infra/ocr` | Realm bootstrap script, PaddleOCR sidecar |
| `scripts/ops`, `scripts/dev` | Operational and local-only helpers; `evaluate-retrieval.ts` for retrieval quality |

## Quick start (local)

Requires Node 22, pnpm, Docker. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full flow.

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d
cp .env.example .env && infra/keycloak/setup-realm.sh --dev-user
pnpm db:migrate && pnpm dev
```

## Deploy

Single-server production stack with automatic HTTPS: see [infra/deploy/README.md](infra/deploy/README.md).
CI (`.github/workflows/ci.yml`) typechecks, lints, tests, builds and scans the images on every PR.

## Quality checks

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
```

Security policy: [SECURITY.md](SECURITY.md). License: [LICENSE](LICENSE).
