import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, pgEnum } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { documents, documentVersions } from './documents';

export const jobStatusEnum = pgEnum('job_status', [
  'pending', 'parsing', 'chunking', 'embedding',
  'indexing', 'validating', 'completed', 'failed', 'cancelled'
]);

export const ingestionJobs = pgTable('ingestion_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  versionId: uuid('version_id').references(() => documentVersions.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  status: jobStatusEnum('status').default('pending').notNull(),
  currentStage: varchar('current_stage', { length: 50 }),
  progress: jsonb('progress').default('{}').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  errorMessage: text('error_message'),
  errorDetails: jsonb('error_details'),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
