import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: '../../.env' });

async function main() {
  console.log('Running raw SQL migration...');
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  const sqlContent = fs.readFileSync(path.join(process.cwd(), '../../packages/database/drizzle', '0000_light_slayback.sql'), 'utf-8');
  await sql.unsafe(sqlContent);

  await sql.end();
  console.log('Migration complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
