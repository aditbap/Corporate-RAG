import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireLibraryPermission, requireUser } from '@rag/auth';
import { LibraryRepository } from '@rag/database';

type Role = 'owner' | 'admin' | 'member' | 'viewer';
const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const ASSIGNABLE: Role[] = ['admin', 'member', 'viewer'];

const libraryRepo = new LibraryRepository();

function fail(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message, requestId: request.id } });
}

/**
 * Whether `actor` may change or remove a member currently holding `target`.
 * Owners can manage anyone; admins can only manage members/viewers — never
 * peers or owners.
 */
function canManage(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true;
  return actor === 'admin' && ROLE_RANK[target] < ROLE_RANK.admin;
}

/** Shared-library management. All `:id` routes authorise against that library's membership. */
export const libraryRoutes: FastifyPluginAsync = async (fastify) => {
  // ---- Libraries I belong to (personal + shared) ----
  fastify.get('/', async (request) => {
    return { data: await libraryRepo.listForUser(requireUser(request).id), currentUserId: requireUser(request).id };
  });

  fastify.post('/', async (request, reply) => {
    const { name, description } = (request.body ?? {}) as { name?: string; description?: string };
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length > 100) return fail(reply, request, 400, 'BAD_REQUEST', 'name is required (max 100 characters)');
    const org = await libraryRepo.create(requireUser(request).id, { name: trimmed, description: description?.trim().slice(0, 500) || undefined });
    return reply.status(201).send({ data: { id: org.id, name: org.name, description: org.description, kind: org.kind, role: 'owner' } });
  });

  // ---- Joining by invite code (no library membership needed yet) ----
  fastify.get('/join/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const inv = await libraryRepo.previewInvite(code);
    if (!inv || !inv.orgActive) return fail(reply, request, 404, 'INVITE_INVALID', 'Invite not found');
    const expired = !!inv.expiresAt && inv.expiresAt.getTime() < Date.now();
    const exhausted = inv.maxUses != null && inv.useCount >= inv.maxUses;
    return { data: { libraryId: inv.orgId, name: inv.name, description: inv.description, role: inv.role, usable: !inv.revokedAt && !expired && !exhausted } };
  });

  fastify.post('/join', async (request, reply) => {
    const { code } = (request.body ?? {}) as { code?: string };
    if (!code || typeof code !== 'string') return fail(reply, request, 400, 'BAD_REQUEST', 'code is required');
    const result = await libraryRepo.joinWithInvite(requireUser(request).id, code.trim());
    if (!result.ok) {
      const status = result.reason === 'INVALID' ? 404 : 410;
      return fail(reply, request, status, `INVITE_${result.reason}`, `Invite is ${result.reason.toLowerCase()}`);
    }
    return { data: { libraryId: result.orgId, role: result.role, alreadyMember: result.alreadyMember } };
  });

  // ---- Single library ----
  fastify.get('/:id', { preHandler: requireLibraryPermission('members:read') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await libraryRepo.get(id);
    if (!org) return fail(reply, request, 404, 'NOT_FOUND', 'Library not found');
    return { data: { id: org.id, name: org.name, description: org.description, kind: org.kind, role: request.userRole } };
  });

  fastify.patch('/:id', { preHandler: requireLibraryPermission('library:update') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { name?: string; description?: string | null };
    const patch: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) {
      const n = body.name.trim();
      if (!n || n.length > 100) return fail(reply, request, 400, 'BAD_REQUEST', 'name must be 1-100 characters');
      patch.name = n;
    }
    if (body.description !== undefined) patch.description = body.description?.trim().slice(0, 500) || null;
    const org = await libraryRepo.update(id, patch);
    if (!org) return fail(reply, request, 400, 'NOT_SHARED', 'Only shared libraries can be edited');
    return { data: { id: org.id, name: org.name, description: org.description } };
  });

  fastify.delete('/:id', { preHandler: requireLibraryPermission('library:delete') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await libraryRepo.archive(id);
    if (!org) return fail(reply, request, 400, 'NOT_SHARED', 'Only shared libraries can be deleted');
    return reply.status(204).send();
  });

  // ---- Members ----
  fastify.get('/:id/members', { preHandler: requireLibraryPermission('members:read') }, async (request) => {
    const { id } = request.params as { id: string };
    // currentUserId lets the UI mark "you" / enable "leave" using the same id the API
    // authorises with, instead of whatever id the web session happens to carry.
    return { data: await libraryRepo.listMembers(id), currentUserId: requireUser(request).id };
  });

  fastify.patch('/:id/members/:userId', { preHandler: requireLibraryPermission('members:manage') }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const { role } = (request.body ?? {}) as { role?: Role };
    const actor = request.userRole as Role;
    if (!role || !(role === 'owner' || ASSIGNABLE.includes(role))) return fail(reply, request, 400, 'BAD_REQUEST', 'Invalid role');
    if (role === 'owner' && actor !== 'owner') return fail(reply, request, 403, 'FORBIDDEN', 'Only an owner can grant ownership');

    const org = await libraryRepo.get(id);
    if (!org || org.kind !== 'shared') return fail(reply, request, 400, 'NOT_SHARED', 'Only shared libraries have managed members');

    const members = await libraryRepo.listMembers(id);
    const target = members.find((m) => m.userId === userId);
    if (!target) return fail(reply, request, 404, 'NOT_FOUND', 'Member not found');
    if (!canManage(actor, target.role as Role)) return fail(reply, request, 403, 'FORBIDDEN', 'You cannot change this member');
    if (target.role === 'owner' && role !== 'owner' && (await libraryRepo.countOwners(id)) <= 1) {
      return fail(reply, request, 409, 'LAST_OWNER', 'A library must keep at least one owner');
    }
    const updated = await libraryRepo.setMemberRole(id, userId, role);
    return { data: { userId, role: updated?.role } };
  });

  // Removing someone else needs members:manage; anyone may remove themselves (leave).
  fastify.delete('/:id/members/:userId', { preHandler: requireLibraryPermission('members:read') }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const actor = request.userRole as Role;
    const self = userId === requireUser(request).id;

    const org = await libraryRepo.get(id);
    if (!org || org.kind !== 'shared') return fail(reply, request, 400, 'NOT_SHARED', 'You cannot leave a personal workspace');

    const members = await libraryRepo.listMembers(id);
    const target = members.find((m) => m.userId === userId);
    if (!target) return fail(reply, request, 404, 'NOT_FOUND', 'Member not found');

    if (!self && !(ROLE_RANK[actor] >= ROLE_RANK.admin && canManage(actor, target.role as Role))) {
      return fail(reply, request, 403, 'FORBIDDEN', 'You cannot remove this member');
    }
    if (target.role === 'owner' && (await libraryRepo.countOwners(id)) <= 1) {
      return fail(reply, request, 409, 'LAST_OWNER', 'Transfer ownership before the last owner leaves');
    }
    await libraryRepo.removeMember(id, userId);
    return reply.status(204).send();
  });

  // ---- Invites ----
  fastify.get('/:id/invites', { preHandler: requireLibraryPermission('members:manage') }, async (request) => {
    const { id } = request.params as { id: string };
    return { data: await libraryRepo.listInvites(id) };
  });

  fastify.post('/:id/invites', { preHandler: requireLibraryPermission('members:manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { role?: Role; expiresInDays?: number; maxUses?: number };
    const actor = request.userRole as Role;
    const role = body.role ?? 'member';
    if (!ASSIGNABLE.includes(role)) return fail(reply, request, 400, 'BAD_REQUEST', 'role must be admin, member or viewer');
    if (role === 'admin' && actor !== 'owner') return fail(reply, request, 403, 'FORBIDDEN', 'Only an owner can invite admins');

    const expiresInDays = body.expiresInDays ?? 7;
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) return fail(reply, request, 400, 'BAD_REQUEST', 'expiresInDays must be 1-90');
    if (body.maxUses !== undefined && (!Number.isInteger(body.maxUses) || body.maxUses < 1 || body.maxUses > 1000)) return fail(reply, request, 400, 'BAD_REQUEST', 'maxUses must be 1-1000');

    const org = await libraryRepo.get(id);
    if (!org || org.kind !== 'shared') return fail(reply, request, 400, 'NOT_SHARED', 'Personal workspaces cannot be shared; create a shared library');

    const invite = await libraryRepo.createInvite(id, requireUser(request).id, { role: role as Exclude<Role, 'owner'>, expiresInDays, maxUses: body.maxUses });
    return reply.status(201).send({ data: invite });
  });

  fastify.delete('/:id/invites/:inviteId', { preHandler: requireLibraryPermission('members:manage') }, async (request, reply) => {
    const { id, inviteId } = request.params as { id: string; inviteId: string };
    const row = await libraryRepo.revokeInvite(id, inviteId);
    if (!row) return fail(reply, request, 404, 'NOT_FOUND', 'Invite not found');
    return reply.status(204).send();
  });
};
