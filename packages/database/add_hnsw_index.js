import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function main() {
  const sql = postgres(process.env.DATABASE_URL);
  try {
    console.log('Adding HNSW index...');
    await sql`CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);`;
    console.log('Index created successfully!');
  } catch (err) {
    console.error('Error creating index:', err);
  }
  process.exit(0);
}
main();
