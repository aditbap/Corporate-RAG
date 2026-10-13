import http from 'node:http';
import { FastifyInstance } from 'fastify';
import client from 'prom-client';
import { ingestionQueue } from '../queue.js';

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

// Ingestion backlog: the signal that uploads are piling up (worker down, embedding API failing).
new client.Gauge({
  name: 'ingestion_queue_jobs',
  help: 'Document-ingestion jobs by state',
  labelNames: ['state'],
  registers: [register],
  async collect() {
    try {
      const counts = await ingestionQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      for (const [state, n] of Object.entries(counts)) this.set({ state }, n);
    } catch {
      /* Redis unreachable: leave the last values; the readiness probe reports the outage */
    }
  },
});

/**
 * Request-duration hook, plus the /metrics endpoint in development. In production /metrics is NOT
 * served on the public API port — it would be reachable by anyone who can reach the API. Instead
 * startMetricsServer() exposes it on a separate internal port (METRICS_PORT) that the reverse
 * proxy never routes to and only Prometheus on the private network can reach.
 */
const requestStart = new WeakMap<object, bigint>();

export function registerMetrics(server: FastifyInstance) {
  server.addHook('onRequest', async (request) => {
    requestStart.set(request, process.hrtime.bigint());
  });

  server.addHook('onResponse', async (request, reply) => {
    const start = requestStart.get(request);
    if (!start) return;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(
      { method: request.method, route: request.routeOptions?.url || request.url, status_code: reply.statusCode },
      durationSeconds
    );
  });

  if (process.env.NODE_ENV !== 'production') {
    server.get('/metrics', async (_request, reply) => {
      reply.header('Content-Type', register.contentType);
      return register.metrics();
    });
  }
}

/** Serves only GET /metrics. Bind to a private interface/network; it carries no authentication. */
export function startMetricsServer(port: number, host = '0.0.0.0'): http.Server {
  const srv = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.end(await register.metrics());
    } else {
      res.writeHead(404).end();
    }
  });
  srv.listen(port, host);
  return srv;
}
