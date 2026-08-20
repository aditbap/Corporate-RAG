import { readFileSync } from 'fs';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const connectionString = (process.env.DATABASE_URL || '').replace(':6543', ':5432');
console.log('Connecting to', connectionString.replace(/:[^:@]+@/, ':***@'));

const sql = postgres(connectionString, { max: 1 });

async function main() {
  try {
    const query = readFileSync(path.resolve(process.cwd(), 'packages/database/src/migrations/0000_light_slayback.sql'), 'utf-8');
    
    console.log('Executing migration...');
    // Postgres.js allows running multiple statements by passing the raw string as an unsafe query
    await sql.unsafe(query);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sql.end();
  }
}

main();
