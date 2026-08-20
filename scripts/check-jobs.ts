import * as dotenv from 'dotenv';
dotenv.config();
const { db, ingestionJobs } = require('../packages/database/src/index');
async function main() {
  try {
    const allJobs = await db.select().from(ingestionJobs);
    console.log('All Jobs:', JSON.stringify(allJobs, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}
main();
