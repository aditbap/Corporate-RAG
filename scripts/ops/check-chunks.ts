import * as dotenv from 'dotenv';
dotenv.config();
const { db, documentChunks } = require('../packages/database/src/index');
async function main() {
  try {
    const allChunks = await db.select().from(documentChunks);
    console.log('Total Chunks:', allChunks.length);
    console.log('Sample Chunk:', allChunks.length > 0 ? allChunks[0] : 'None');
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}
main();
