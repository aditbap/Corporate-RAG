import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const ingestionQueue = new Queue('document-ingestion', { connection });

async function main() {
  try {
    const active = await ingestionQueue.getActive();
    const waiting = await ingestionQueue.getWaiting();
    const completed = await ingestionQueue.getCompleted();
    const failed = await ingestionQueue.getFailed();
    console.log(`Active: ${active.length}, Waiting: ${waiting.length}, Completed: ${completed.length}, Failed: ${failed.length}`);
    if (failed.length > 0) {
      console.log('Last Failed Job Error:', failed[0].failedReason);
      console.log('Last Failed Job Stacktrace:', failed[0].stacktrace);
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
main();
