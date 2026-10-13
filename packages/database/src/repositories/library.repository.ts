import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { organizations } from '../schema/organizations.js';
import { users, memberships, libraryInvites } from '../schema/users.js';
import { documents } from '../schema/documents.js';

type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type JoinResult =
  | { ok: true; orgId: string; role: Role; alreadyMember: boolean }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'EXHAUSTED' };

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'library';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Shared-library (organization) management: lifecycle, members and invites.
 * Unlike the other repositories these methods take the target library id
 * explicitly — callers are responsible for authorising the acting user against
 * that library first (see apps/api/src/routes/libraries.ts).
 */
export class LibraryRepository extends BaseRepository {
  constructor() {
    super('organizations');
  }

  /** Every active library the user belongs to, with their role and basic counts. */
  async listForUser(userId: string) {
    return this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        description: organizations.description,
        kind: organizations.kind,
        role: memberships.role,
        memberCount: sql<number>`(select count(*)::int from ${memberships} m where m.org_id = ${organizations.id} and m.is_active = true)`,
        documentCount: sql<number>`(select count(*)::int from ${documents} d where d.org_id = ${organizations.id} and d.is_deleted = false)`,
        storageBytes: sql<number>`(select coalesce(sum(v.file_size_bytes), 0)::float8 from document_versions v join documents d on d.id = v.document_id where v.org_id = ${organizations.id} and d.is_deleted = false)`,
        maxDocuments: organizations.maxDocuments,
        maxStorageMb: organizations.maxStorageMb,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true), eq(organizations.isActive, true)))
      .orderBy(desc(organizations.kind), organizations.name); // 'shared' before 'personal'
  }

  async create(userId: string, input: { name: string; description?: string }) {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: input.name, slug: slugify(input.name), description: input.description ?? null, kind: 'shared', createdBy: userId,
          // Deployment-wide defaults for new libraries (existing rows keep their own limits).
          ...(process.env.DEFAULT_MAX_DOCUMENTS ? { maxDocuments: parseInt(process.env.DEFAULT_MAX_DOCUMENTS, 10) } : {}),
          ...(process.env.DEFAULT_MAX_STORAGE_MB ? { maxStorageMb: parseInt(process.env.DEFAULT_MAX_STORAGE_MB, 10) } : {}),
        })
        .returning();
      if (!org) throw new Error('Failed to create library');
      await tx.insert(memberships).values({ userId, orgId: org.id, role: 'owner' });
      return org;
    });
  }

  async update(orgId: string, patch: { name?: string; description?: string | null }) {
    this.requireTenant(orgId);
    const [org] = await this.db
      .update(organizations)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(organizations.id, orgId), eq(organizations.kind, 'shared')))
      .returning();
    return org;
  }

  /** Soft-delete: stored files and chunks stay until an operator purges them. */
  async archive(orgId: string) {
    this.requireTenant(orgId);
    const [org] = await this.db
      .update(organizations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(organizations.id, orgId), eq(organizations.kind, 'shared')))
      .returning();
    return org;
  }

  async get(orgId: string) {
    this.requireTenant(orgId);
    const [org] = await this.db.select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.isActive, true))).limit(1);
    return org;
  }

  async listMembers(orgId: string) {
    this.requireTenant(orgId);
    return this.db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: memberships.role,
        joinedAt: memberships.createdAt,
        documentCount: sql<number>`(select count(*)::int from ${documents} d where d.org_id = ${memberships.orgId} and d.uploaded_by = ${users.id} and d.is_deleted = false)`,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.isActive, true)))
      .orderBy(memberships.createdAt);
  }

  async setMemberRole(orgId: string, userId: string, role: Role) {
    this.requireTenant(orgId);
    const [row] = await this.db
      .update(memberships)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.isActive, true)))
      .returning();
    return row;
  }

  async removeMember(orgId: string, userId: string) {
    this.requireTenant(orgId);
    const [row] = await this.db
      .delete(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .returning();
    return row;
  }

  async countOwners(orgId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner'), eq(memberships.isActive, true)));
    return row?.n ?? 0;
  }

  async createInvite(orgId: string, createdBy: string, opts: { role: Exclude<Role, 'owner'>; expiresInDays?: number; maxUses?: number }) {
    this.requireTenant(orgId);
    const expiresAt = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000) : null;
    const [invite] = await this.db
      .insert(libraryInvites)
      .values({ orgId, createdBy, role: opts.role, code: randomBytes(24).toString('base64url'), expiresAt, maxUses: opts.maxUses ?? null })
      .returning();
    return invite;
  }

  async listInvites(orgId: string) {
    this.requireTenant(orgId);
    return this.db
      .select()
      .from(libraryInvites)
      .where(and(eq(libraryInvites.orgId, orgId), isNull(libraryInvites.revokedAt)))
      .orderBy(desc(libraryInvites.createdAt));
  }

  async revokeInvite(orgId: string, inviteId: string) {
    this.requireTenant(orgId);
    const [row] = await this.db
      .update(libraryInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(libraryInvites.id, inviteId), eq(libraryInvites.orgId, orgId)))
      .returning();
    return row;
  }

  /** Peek at an invite (library name + role) without consuming it. */
  async previewInvite(code: string) {
    const [row] = await this.db
      .select({
        orgId: libraryInvites.orgId,
        role: libraryInvites.role,
        name: organizations.name,
        description: organizations.description,
        expiresAt: libraryInvites.expiresAt,
        revokedAt: libraryInvites.revokedAt,
        maxUses: libraryInvites.maxUses,
        useCount: libraryInvites.useCount,
        orgActive: organizations.isActive,
      })
      .from(libraryInvites)
      .innerJoin(organizations, eq(organizations.id, libraryInvites.orgId))
      .where(eq(libraryInvites.code, code))
      .limit(1);
    return row;
  }

  /**
   * Consumes an invite and creates the membership atomically. The use-count
   * bump is a conditional UPDATE so concurrent joins can't exceed maxUses.
   * An existing member is never downgraded or charged against the invite.
   */
  async joinWithInvite(userId: string, code: string): Promise<JoinResult> {
    return this.db.transaction(async (tx) => {
      const [invite] = await tx
        .select({ invite: libraryInvites, active: organizations.isActive })
        .from(libraryInvites)
        .innerJoin(organizations, eq(organizations.id, libraryInvites.orgId))
        .where(eq(libraryInvites.code, code))
        .limit(1);
      if (!invite || !invite.active) return { ok: false, reason: 'INVALID' } as const;
      const inv = invite.invite;
      if (inv.revokedAt) return { ok: false, reason: 'REVOKED' } as const;
      if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' } as const;

      const [existing] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.orgId, inv.orgId), eq(memberships.userId, userId), eq(memberships.isActive, true)))
        .limit(1);
      if (existing) return { ok: true, orgId: inv.orgId, role: existing.role, alreadyMember: true } as const;

      const claimed = await tx
        .update(libraryInvites)
        .set({ useCount: sql`${libraryInvites.useCount} + 1` })
        .where(and(eq(libraryInvites.id, inv.id), sql`(${libraryInvites.maxUses} is null or ${libraryInvites.useCount} < ${libraryInvites.maxUses})`))
        .returning({ id: libraryInvites.id });
      if (claimed.length === 0) return { ok: false, reason: 'EXHAUSTED' } as const;

      await tx
        .insert(memberships)
        .values({ userId, orgId: inv.orgId, role: inv.role })
        .onConflictDoUpdate({ target: [memberships.userId, memberships.orgId], set: { role: inv.role, isActive: true, updatedAt: new Date() } });
      return { ok: true, orgId: inv.orgId, role: inv.role, alreadyMember: false } as const;
    });
  }
}
