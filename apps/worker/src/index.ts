import './setup.js';
import { assertProductionConfig } from '@rag/core';
import { MinioStorageProvider } from '@rag/providers';
import { queryClient } from '@rag/database';
import { purgeExpired } from './maintenance.js';
import { redisConnection } from './queue.js';

assertProductionConfig('worker');

// Imported after the config check so a bad configuration is reported instead of a downstream error.
const { ingestionWorker } = await import('./worker.js');

console.log('Worker process starting...');

// Retention maintenance: permanently purge soft-deleted documents/libraries after a grace period.
// A Redis lock keeps multiple worker replicas from running it at once.
const retentionDays = parseInt(process.env.PURGE_RETENTION_DAYS || '30', 10);
const storage = MinioStorageProvider.fromEnv();
const runMaintenance = async () => {
  const locked = await redisConnection.set('rag:maintenance-lock', String(process.pid), 'EX', 3600, 'NX');
  if (!locked) return;
  try {
    const r = await purgeExpired(storage, retentionDays);
    if (r.librariesPurged || r.documentsPurged) console.log('[Maintenance] purged', JSON.stringify(r));
  } catch (err) {
    console.error('[Maintenance] purge failed:', err);
  } finally {
    await redisConnection.del('rag:maintenance-lock').catch(() => undefined);
  }
};
const firstRun = setTimeout(runMaintenance, 60_000);
const interval = setInterval(runMaintenance, 6 * 3600_000);

const shutdown = async () => {
  console.log('Shutting down worker process gracefully...');
  clearTimeout(firstRun);
  clearInterval(interval);
  await ingestionWorker.close();
  await redisConnection.quit().catch(() => undefined);
  await queryClient.end({ timeout: 5 }).catch(() => undefined);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
