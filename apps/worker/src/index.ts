import './setup.js';
import { ingestionWorker } from './worker.js';

console.log('Worker process starting...');

const shutdown = async () => {
  console.log('Shutting down worker process gracefully...');
  await ingestionWorker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
