import { pgTable, uuid, text, varchar, integer, boolean, timestamp, jsonb, customType } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { documents, documentVersions } from './documents';

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  versionId: uuid('version_id').references(() => documentVersions.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  tokenCount: integer('token_count').notNull(),
  pageNumber: integer('page_number'),
  sectionHeading: text('section_heading'),
  // Foreign key for self-reference (parentChunkId) will be added manually or at query level to avoid circular deps
  parentChunkId: uuid('parent_chunk_id'),
  metadata: jsonb('metadata').default('{}').notNull(),
  embeddingModel: varchar('embedding_model', { length: 100 }),
  embedding: customType<{ data: number[]; driverData: string }>({
    dataType() {
      return 'vector(2048)';
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
  })('embedding'),
  qdrantPointId: uuid('qdrant_point_id'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
