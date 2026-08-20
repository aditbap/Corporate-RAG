import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const ingestionQueue = new Queue('ingestion-queue', { connection });

async function main() {
  try {
    const failed = await ingestionQueue.getFailed();
    console.log(`Failed Jobs Count: ${failed.length}`);
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
