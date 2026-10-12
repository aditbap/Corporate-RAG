import { FastifyInstance } from 'fastify';
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const ragPipelineDuration = new client.Histogram({
  name: 'rag_pipeline_stage_duration_seconds',
  help: 'Duration of a RAG pipeline stage (retrieval, rerank, generation)',
  labelNames: ['stage'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const ragCacheHits = new client.Counter({
  name: 'rag_chat_cache_hits_total',
  help: 'Chat completion responses served from the Redis cache',
  registers: [register],
});

/**
 * Registers the /metrics scrape endpoint and a request-duration hook. Deliberately
 * NOT behind the `authenticate` hook (it's mounted outside the /api/v1 context,
 * same as /health) — Prometheus has no way to carry a Keycloak bearer token, and
 * this endpoint only exposes aggregate counters, not per-tenant data.
 */
export function registerMetrics(server: FastifyInstance) {
  server.addHook('onRequest', async (request) => {
    (request as any)._metricsStart = process.hrtime.bigint();
  });

  server.addHook('onResponse', async (request, reply) => {
    const start = (request as any)._metricsStart as bigint | undefined;
    if (!start) return;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(
      { method: request.method, route: request.routeOptions?.url || request.url, status_code: reply.statusCode },
      durationSeconds
    );
  });

  server.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
}
