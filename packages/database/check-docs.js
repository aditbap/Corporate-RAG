import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });
const sql = postgres(process.env.DATABASE_URL);

async function main() {
  try {
    const docs = await sql`SELECT id, file_name, folder_id FROM documents ORDER BY created_at DESC LIMIT 5;`;
    console.log('Documents:', docs);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
main();
