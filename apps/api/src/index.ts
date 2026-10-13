import './setup.js';
import { assertProductionConfig } from '@rag/core';
import { buildServer } from './server.js';
import { startMetricsServer } from './plugins/metrics.js';
import { redisConnection, ingestionQueue } from './queue.js';
import { queryClient } from '@rag/database';

const start = async () => {
  assertProductionConfig('api');

  const server = buildServer();

  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port, host });
    server.log.info(`Server listening at http://${host}:${port} (${process.env.NODE_ENV ?? 'development'})`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Production exposes metrics on a separate internal port (see plugins/metrics.ts).
  const metricsPort = parseInt(process.env.METRICS_PORT || '', 10);
  const metricsServer = Number.isFinite(metricsPort) ? startMetricsServer(metricsPort) : null;

  // Graceful shutdown: stop accepting requests, let in-flight ones finish, then release connections
  // so `docker stop` / a rolling restart doesn't cut uploads or chat streams mid-flight.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    try {
      await server.close();
      metricsServer?.close();
      await ingestionQueue.close();
      await redisConnection.quit();
      await queryClient.end({ timeout: 5 });
      process.exit(0);
    } catch (err) {
      server.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

start();
