import { FastifyRequest, FastifyReply } from 'fastify';
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

  request.user = {
    id: result.userId,
    email: result.email,
    orgId: result.orgId,
  };
  if (result.role) {
    request.userRole = result.role as Role;
  }
}

/**
 * Fastify middleware factory to enforce RBAC permissions
 */
export function requirePermissionMiddleware(action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Requires authenticate middleware to have run first
    if (!request.user) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId: request.id } });
    }

    // In a real app, you would fetch the user's role from the database for this orgId.
    // For this example, we assume `request.userRole` is populated by another middleware
    // that fetches the membership.
    // Default to 'owner' for this demo so users can upload, chat, and delete
    const role = request.userRole || 'owner';

    if (!hasPermission(role, action)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: `Permission denied: requires '${action}' action`, requestId: request.id } });
    }
  };
}
