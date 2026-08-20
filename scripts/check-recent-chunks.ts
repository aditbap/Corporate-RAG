import * as dotenv from 'dotenv';
dotenv.config();
const { db, documentChunks, sql } = require('../packages/database/src/index');
async function main() {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    const recentChunks = await db.execute(sql`SELECT count(*) FROM document_chunks WHERE created_at >= ${today.toISOString()}`);
    console.log('Recent Chunks (Today):', recentChunks);
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}
main();
