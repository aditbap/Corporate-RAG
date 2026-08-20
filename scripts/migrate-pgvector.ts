import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const connectionString = (process.env.DATABASE_URL || '').replace(':6543', ':5432');
const sql = postgres(connectionString, { max: 1 });

async function main() {
  try {
    console.log('Enabling pgvector extension and adding embedding column...');
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector;');
    await sql.unsafe('ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(768);');
    // We should also add HNSW index for fast search!
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);`);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sql.end();
  }
}

main();
