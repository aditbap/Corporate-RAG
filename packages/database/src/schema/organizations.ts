import { pgTable, uuid, varchar, jsonb, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  settings: jsonb('settings').default('{}').notNull(),
  plan: varchar('plan', { length: 50 }).default('free').notNull(),
  maxDocuments: integer('max_documents').default(100).notNull(),
  maxStorageMb: integer('max_storage_mb').default(1024).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
