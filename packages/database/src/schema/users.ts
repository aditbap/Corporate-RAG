import { pgTable, uuid, varchar, text, boolean, integer, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // Matches the Keycloak JWT `sub` claim
  email: varchar('email', { length: 320 }).notNull().unique(),
  fullName: varchar('full_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'admin', 'member', 'viewer']);

export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  role: membershipRoleEnum('role').default('member').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userOrgUnique: uniqueIndex('memberships_user_org_unique').on(t.userId, t.orgId),
}));

// Shareable invite codes for joining a shared library. The code itself is the
// credential: 192 random bits, revocable, expiring, and capped by maxUses.
export const libraryInvites = pgTable('library_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  role: membershipRoleEnum('role').default('member').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  maxUses: integer('max_uses'),
  useCount: integer('use_count').default(0).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
