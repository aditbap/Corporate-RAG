import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FolderRepository } from '@rag/database';
import { requirePermissionMiddleware } from '@rag/auth';

export default async function (fastify: FastifyInstance) {
  const folderRepo = new FolderRepository();

  fastify.get('/', { preHandler: requirePermissionMiddleware('documents:read') }, async (request, reply) => {
    const tenantId = request.user?.orgId || request.user?.id;
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const { parentId } = request.query as any;
    const parsedParentId = parentId === 'null' ? null : (parentId || undefined);

    const schema = z.object({
      parentId: z.string().uuid().optional().nullable(),
    });

    const query = schema.safeParse({ parentId: parsedParentId });
    if (!query.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: query.error.errors[0]?.message || 'Invalid request' } });
    }

    try {
      const folders = await folderRepo.list(tenantId, parsedParentId);
      return { data: folders };
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch folders' } });
    }
  });

  fastify.post('/', { preHandler: requirePermissionMiddleware('documents:create') }, async (request, reply) => {
    const tenantId = request.user?.orgId || request.user?.id;
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const { name, parentId } = request.body as any;
    const parsedParentId = parentId === 'null' ? null : (parentId || undefined);

    const schema = z.object({
      name: z.string().min(1).max(255),
      parentId: z.string().uuid().optional().nullable(),
    });

    const body = schema.safeParse({ name, parentId: parsedParentId });
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: body.error.errors[0]?.message || 'Invalid request' } });
    }

    try {
      const folder = await folderRepo.create(tenantId, body.data);
      return reply.status(201).send({ data: folder });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create folder' } });
    }
  });

  fastify.delete('/:id', { preHandler: requirePermissionMiddleware('documents:delete') }, async (request, reply) => {
    const tenantId = request.user?.orgId || request.user?.id;
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const schema = z.object({
      id: z.string().uuid(),
    });

    const params = schema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: params.error.errors[0]?.message || 'Invalid request' } });
    }

    try {
      await folderRepo.delete(tenantId, params.data.id);
      return reply.status(204).send();
    } catch (error: any) {
      if (error.message === 'FOLDER_NOT_EMPTY') {
        return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Folder is not empty. Cannot delete.' } });
      }
      request.log.error(error);
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete folder' } });
    }
  });

  fastify.patch('/:id', { preHandler: requirePermissionMiddleware('documents:update') }, async (request, reply) => {
    const tenantId = request.user?.orgId || request.user?.id;
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const paramsSchema = z.object({
      id: z.string().uuid(),
    });

    const bodySchema = z.object({
      name: z.string().min(1).max(255),
    });

    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
    }

    try {
      const folder = await folderRepo.rename(tenantId, params.data.id, body.data.name);
      return reply.status(200).send({ data: folder });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to rename folder' } });
    }
  });
}
