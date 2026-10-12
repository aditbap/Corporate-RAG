import { FastifyRequest, FastifyReply } from 'fastify';
import { MembershipRepository, db, users, organizations, sql } from '@rag/database';
import { verifyJwt } from './jwt-verify.js';
import { hasPermission, Role, Action } from './rbac.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email?: string;
      orgId?: string;
    };
    userRole?: Role;
  }
}

const membershipRepo = new MembershipRepository();

/**
 * The authenticated user for a request. `authenticate` (an onRequest hook on every /api/v1
 * route) always sets `request.user` or rejects the request, so reaching a handler without it is
 * a wiring bug — fail loudly instead of sprinkling `!` assertions.
 */
export function requireUser(request: FastifyRequest): NonNullable<FastifyRequest['user']> {
  if (!request.user) throw new Error('requireUser called on an unauthenticated request');
  return request.user;
}

// Per-process cache so we don't re-run the provisioning upserts on every request
// for the same user/org. Not shared across API instances — acceptable for a
// single-instance dev/small-prod deployment; a multi-instance deployment would
// still be correct (the upserts are idempotent) just not cache-accelerated.
const provisionedOrgs = new Set<string>();

/**
 * Self-service provisioning: a Keycloak token with no `org_id` claim means the
 * user operates their own personal workspace (org id == user id), matching the
 * `orgId || userId` fallback used throughout the route handlers. This must run
 * BEFORE any requirePermissionMiddleware check, otherwise a first-time user has
 * no membership row yet and gets rejected before they can create one.
 */
async function ensurePersonalWorkspace(userId: string, email: string | undefined, orgId: string, name?: string) {
  const cacheKey = `${userId}:${orgId}`;
  if (provisionedOrgs.has(cacheKey)) return;

  const resolvedEmail = email || `user-${userId}@example.com`;
  await db.insert(users).values({
    id: userId,
    email: resolvedEmail,
    fullName: name || email || 'User',
  }).onConflictDoUpdate({
    target: users.id,
    // Upgrade a placeholder name (null / the email we used before the `name` claim
    // was read) to the real display name, but never overwrite a name that differs.
    set: { fullName: sql`CASE WHEN ${users.fullName} IS NULL OR ${users.fullName} = ${users.email} OR ${users.fullName} = 'User' THEN ${name ?? null}::text ELSE ${users.fullName} END`, updatedAt: new Date() },
    setWhere: sql`${name ?? null}::text IS NOT NULL`,
  });

  await db.insert(organizations).values({
    id: orgId,
    name: 'Personal Workspace',
    slug: `personal-${orgId}`,
  }).onConflictDoNothing();

  await membershipRepo.ensureMembership(userId, orgId, 'owner');

  provisionedOrgs.add(cacheKey);
}

/**
 * Fastify middleware to authenticate requests using JWT
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header', requestId: request.id } });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token', requestId: request.id } });
  }

  const result = await verifyJwt(token);

  if (!result.isValid) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: result.error || 'Invalid token', requestId: request.id } });
  }

  // Only fall back to "org == self" when the token carries no org_id claim at
  // all. If a token DOES claim an org_id, never auto-provision membership for
  // it here — that would let anyone who guesses/forges an org_id claim grant
  // themselves ownership of it. A real org requires an admin-created membership.
  const isSelfWorkspace = !result.orgId;
  const orgId = result.orgId || result.userId;

  request.user = {
    id: result.userId,
    email: result.email,
    orgId,
  };

  if (isSelfWorkspace) {
    try {
      await ensurePersonalWorkspace(result.userId, result.email, orgId, result.name);
    } catch (err) {
      request.log.error(err, 'Failed to provision personal workspace');
    }
  }

  // Active-library switch. A user can belong to several libraries (personal +
  // shared); the client picks one per request with `X-Org-Id`. The header is
  // only a *request* — it is honoured solely if the user has an active
  // membership in that org, otherwise the request is rejected outright rather
  // than silently falling back (which would show the wrong library's data).
  const requested = request.headers['x-org-id'];
  const requestedOrgId = Array.isArray(requested) ? requested[0] : requested;
  if (requestedOrgId && requestedOrgId !== orgId) {
    if (!UUID_RE.test(requestedOrgId)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid X-Org-Id header', requestId: request.id } });
    }
    const role = await membershipRepo.getRole(result.userId, requestedOrgId);
    if (!role) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'No membership found for the requested library', requestId: request.id } });
    }
    request.user.orgId = requestedOrgId;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Like requirePermissionMiddleware, but authorises against the library named by
 * the route's `:id` param instead of the active (X-Org-Id) library. Used by the
 * library-management routes, which act on a specific library regardless of
 * which one the user currently has selected.
 */
export function requireLibraryPermission(action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId: request.id } });
    }
    const { id } = request.params as { id?: string };
    if (!id || !UUID_RE.test(id)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid library id', requestId: request.id } });
    }
    const role = (await membershipRepo.getRole(request.user.id, id)) as Role | null;
    // 404 (not 403) for non-members so library ids can't be probed.
    if (!role) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Library not found', requestId: request.id } });
    }
    request.userRole = role;
    // An array means "any of" — used where a weaker "own" variant is enough to enter the
    // route and the handler then checks ownership (see canMutateDocument).
    const actions = Array.isArray(action) ? action : [action];
    if (!actions.some((a) => hasPermission(role, a))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: `Permission denied: requires '${actions[0]}' action`, requestId: request.id } });
    }
  };
}

/**
 * Fastify middleware factory to enforce RBAC permissions.
 * Role is looked up from the `memberships` table for the authenticated user +
 * their org on every request — there is no default role. No membership record
 * means no access, full stop.
 */
export function requirePermissionMiddleware(action: Action | Action[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId: request.id } });
    }

    const { id: userId, orgId } = request.user;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization', requestId: request.id } });
    }

    const role = (await membershipRepo.getRole(userId, orgId)) as Role | null;
    if (!role) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'No membership found for this organization', requestId: request.id } });
    }
    request.userRole = role;

    // An array means "any of" — used where a weaker "own" variant is enough to enter the
    // route and the handler then checks ownership (see canMutateDocument).
    const actions = Array.isArray(action) ? action : [action];
    if (!actions.some((a) => hasPermission(role, a))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: `Permission denied: requires '${actions[0]}' action`, requestId: request.id } });
    }
  };
}
