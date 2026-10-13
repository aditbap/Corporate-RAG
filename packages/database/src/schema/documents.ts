import { pgTable, uuid, varchar, text, bigint, boolean, timestamp, jsonb, integer, pgEnum } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { folders } from './folders.js';

export const documentStatusEnum = pgEnum('document_status', ['uploaded', 'processing', 'ready', 'failed', 'deleted']);

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileType: varchar('file_type', { length: 50 }).notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  fileHash: varchar('file_hash', { length: 64 }).notNull(),
  status: documentStatusEnum('status').default('uploaded').notNull(),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  activeVersionId: uuid('active_version_id'), // FK self-reference added later or left as UUID
  tags: text('tags').array().default([]),
  metadata: jsonb('metadata').default('{}').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  errorMessage: text('error_message'),
  notes: text('notes'),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  versionNumber: integer('version_number').notNull(),
  filePath: text('file_path').notNull(),
  fileHash: varchar('file_hash', { length: 64 }).notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  chunkCount: integer('chunk_count').default(0),
  isActive: boolean('is_active').default(false).notNull(),
  isIndexed: boolean('is_indexed').default(false).notNull(),
  parsedContent: jsonb('parsed_content'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
