-- Functional GIN index for BM25-style full-text search over chunk content.
-- Not modeled as a generated column in the Drizzle schema (src/schema/chunks.ts)
-- since the query only ever needs the expression, not the column itself --
-- ChunkRepository.searchBM25() uses the identical to_tsvector(...) expression
-- so Postgres can use this index.
CREATE INDEX IF NOT EXISTS "idx_chunks_content_fts" ON "document_chunks"
  USING GIN (to_tsvector('english', "content"));
--> statement-breakpoint
