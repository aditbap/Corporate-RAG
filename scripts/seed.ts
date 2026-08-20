import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const connectionString = (process.env.DATABASE_URL || '').replace(':6543', ':5432');
const sql = postgres(connectionString, { max: 1 });

async function main() {
  try {
    const orgId = '00000000-0000-0000-0000-000000000000';
    const userId = '11111111-1111-1111-1111-111111111111';
    
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Test Org', 'test-org') ON CONFLICT (slug) DO NOTHING`;
    await sql`INSERT INTO users (id, email, full_name) VALUES (${userId}, 'test@example.com', 'Test User') ON CONFLICT (email) DO NOTHING`;
    
    console.log('Seed completed successfully!');
  } catch (error) {
    console.error('Seed failed:', error);
  } finally {
    await sql.end();
  }
}

main();
