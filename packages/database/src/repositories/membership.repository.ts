import { BaseRepository } from './base.repository.js';
import { memberships } from '../schema/users.js';
import { organizations } from '../schema/organizations.js';
import { and, eq } from 'drizzle-orm';

export class MembershipRepository extends BaseRepository {
  constructor() {
    super('memberships');
  }

  /**
   * Returns the active role of a user within an org, or null if no membership exists.
   * Callers MUST treat null as "no access" — never default to a role.
   */
  async getRole(userId: string, orgId: string): Promise<string | null> {
    this.requireTenant(orgId);
    const [row] = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.isActive, true), eq(organizations.isActive, true)))
      .limit(1);
    return row?.role ?? null;
  }

  /**
   * Creates a membership if one doesn't already exist for this user/org pair.
   * Not atomic (no unique constraint on user_id+org_id yet) — acceptable for the
   * current self-provisioning-on-first-upload flow, which only ever targets a
   * freshly created org for that same user.
   */
  async ensureMembership(userId: string, orgId: string, role: 'owner' | 'admin' | 'member' | 'viewer') {
    const existing = await this.getRole(userId, orgId);
    if (existing) return;
    await this.db.insert(memberships).values({ userId, orgId, role }).onConflictDoNothing();
  }
}
