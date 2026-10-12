import { pgTable, uuid, varchar, text, jsonb, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  // 'personal' = auto-provisioned single-user workspace (id == user id); 'shared' = collaborative library.
  kind: varchar('kind', { length: 20 }).default('personal').notNull(),
  description: text('description'),
  createdBy: uuid('created_by'),
  settings: jsonb('settings').default('{}').notNull(),
  plan: varchar('plan', { length: 50 }).default('free').notNull(),
  maxDocuments: integer('max_documents').default(100).notNull(),
  maxStorageMb: integer('max_storage_mb').default(1024).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
