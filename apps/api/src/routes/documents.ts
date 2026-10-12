import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { requirePermissionMiddleware, requireUser, canMutateDocument, type Role } from '@rag/auth';
import { DocumentRepository, JobRepository, FolderRepository } from '@rag/database';
import { MinioStorageProvider } from '@rag/providers';
import { ingestionQueue, redisConnection } from '../queue.js';
import { consumeRateLimit } from '../lib/rate-limit.js';
import crypto from 'crypto';
import { Transform } from 'stream';

/**
 * Hash a stream as it passes through. Using a pass-through (rather than a
 * 'data' listener on the source) keeps the source paused until the storage
 * client starts reading — a bare 'data' listener switches the stream to flowing
 * mode immediately and the bytes are gone before putObject attaches.
 */
function hashingStream(hash: crypto.Hash): Transform {
  return new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
}


const docRepo = new DocumentRepository();
const jobRepo = new JobRepository();
const storage = MinioStorageProvider.fromEnv();
const folderRepo = new FolderRepository();
const UPLOAD_RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_UPLOAD_PER_MINUTE || '30', 10);

/** Per user, per library: each upload starts a (paid) embedding job, so cap the rate. */
async function uploadRateLimited(request: FastifyRequest, reply: FastifyReply, orgId: string): Promise<boolean> {
  const limit = await consumeRateLimit(redisConnection, `rate-limit:upload:${orgId}:${requireUser(request).id}`, UPLOAD_RATE_LIMIT_PER_MINUTE, 60);
  if (limit.allowed) return false;
  reply.status(429).send({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many uploads. Please try again in a minute.', requestId: request.id } });
  return true;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Invalidate cached chat answers for an org (see chat.ts `cacheVersion`). Best-effort. */
async function bumpCacheVersion(orgId: string) {
  try { await redisConnection.incr(`rag:cache-version:${orgId}`); } catch { /* cache is best-effort */ }
}

// Define allowed mime types per our implementation plan
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/html',
  'image/jpeg',
  'image/png',
  'image/webp'
];

/** 403 unless the caller may update/delete this document (admins: any; members: only their own uploads). */
function denyIfNotAllowed(request: FastifyRequest, reply: FastifyReply, verb: 'update' | 'delete', uploadedBy: string | null | undefined) {
  if (canMutateDocument(request.userRole as Role, verb, uploadedBy, requireUser(request).id)) return false;
  reply.status(403).send({ error: { code: 'FORBIDDEN', message: `You can only ${verb} documents you uploaded`, requestId: request.id } });
  return true;
}

export const documentRoutes: FastifyPluginAsync = async (fastify) => {
  // Reject malformed ids up front: a non-UUID would otherwise reach Postgres and surface as a 500.
  fastify.addHook('preValidation', async (request, reply) => {
    const id = (request.params as { id?: string } | undefined)?.id;
    if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  });
  // Get all documents
  fastify.get('/', {
    preHandler: requirePermissionMiddleware('documents:read'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { limit, offset, folderId } = request.query as { limit?: string; offset?: string; folderId?: string };
    const parsedFolderId = folderId === 'null' ? null : (folderId || undefined);
    // Bounded page size: an unbounded `limit` would let one request load a whole library.
    const pageSize = Math.min(Math.max(parseInt(limit ?? '', 10) || 20, 1), 200);
    const docs = await docRepo.listWithUploader(orgId, pageSize, Math.max(parseInt(offset ?? '', 10) || 0, 0), parsedFolderId);
    return { data: docs };
  });

  // Upload a new document
  fastify.post('/upload', {
    preHandler: requirePermissionMiddleware('documents:create'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }
    
    // User/org/membership provisioning for the personal-workspace fallback now
    // happens centrally in the `authenticate` middleware (packages/auth), before
    // requirePermissionMiddleware runs — see ensurePersonalWorkspace there.

    if (await uploadRateLimited(request, reply, orgId)) return;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: `Unsupported file type: ${data.mimetype}` } });
    }

    const objectKey = `${orgId}/${crypto.randomUUID()}-${data.filename}`;

    // Hash the file as it streams through to MinIO
    const hash = crypto.createHash('sha256');
    const hashed = data.file.pipe(hashingStream(hash));
    data.file.on('error', (err: Error) => hashed.destroy(err));

    let objectInfo;
    try {
      objectInfo = await storage.upload(objectKey, hashed, data.mimetype);
    } catch (err) {
      request.log.error(err, 'Failed to upload file to storage');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process file' } });
    }

    const fileHash = hash.digest('hex');
    const fileSizeBytes = objectInfo.sizeBytes;

    const fileType = data.mimetype.includes('pdf') ? 'pdf' :
                     data.mimetype.includes('word') ? 'docx' :
                     data.mimetype.includes('html') ? 'html' :
                     data.mimetype.includes('markdown') ? 'md' :
                     data.mimetype.includes('jpeg') ? 'jpeg' :
                     data.mimetype.includes('png') ? 'png' :
                     data.mimetype.includes('webp') ? 'webp' : 'txt';

    const folderField = data.fields?.folderId;
    // The web client sends the string 'null' for "library root".
    const rawFolderId = folderField && !Array.isArray(folderField) && 'value' in folderField && typeof folderField.value === 'string'
      ? folderField.value
      : undefined;
    const folderId = rawFolderId && rawFolderId !== 'null' ? rawFolderId : undefined;
    if (folderId !== undefined) {
      // Must be a folder in this library (also keeps a non-UUID from reaching Postgres as a 500).
      const folder = UUID_RE.test(folderId) ? await folderRepo.getById(orgId, folderId) : null;
      if (!folder) {
        return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Folder not found in this library' } });
      }
    }

    // Create Document record in DB
    const doc = await docRepo.create(orgId, {
      orgId,
      title: data.filename,
      fileName: data.filename,
      fileType,
      fileSizeBytes,
      fileHash,
      status: 'uploaded',
      folderId: folderId ?? null,
      uploadedBy: request.user?.id,
      metadata: {},
    });

    if (!doc) {
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create document record' } });
    }

    const version = await docRepo.createNewVersion(orgId, doc.id, {
      filePath: objectKey,
      fileHash,
      fileSizeBytes,
    });
    const versionId = version.id;

    const jobId = crypto.randomUUID();
    
    // Create Job record in DB to track progress
    try {
      await jobRepo.create(orgId, {
        id: jobId,
        documentId: doc.id,
        versionId: versionId,
        orgId: orgId,
        status: 'pending',
        idempotencyKey: crypto.randomUUID()
      });
    } catch (err) {
      request.log.error(err, 'Failed to create job tracking record');
    }

    // Then enqueue the background job
    const job = await ingestionQueue.add(
      'ingest-document',
      {
        jobId,
        documentId: doc.id,
        versionId: versionId,
        orgId,
        filePath: objectKey,
        fileType,
      },
      {
        jobId: crypto.randomUUID(), // unique bullmq id
      }
    );

    return reply.status(201).send({ data: doc, jobId: job.id });
  });

  // Upload a replacement file for an existing document — creates a new version,
  // deactivates the previous one, and re-triggers ingestion. The document id
  // (and its conversation citations/history) stays stable across versions.
  fastify.post('/:id/versions', {
    preHandler: requirePermissionMiddleware(['documents:update', 'documents:update:own']),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const existingDoc = await docRepo.findById(orgId, id);
    if (!existingDoc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }
    if (denyIfNotAllowed(request, reply, 'update', existingDoc.uploadedBy)) return;
    if (await uploadRateLimited(request, reply, orgId)) return;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: `Unsupported file type: ${data.mimetype}` } });
    }

    const objectKey = `${orgId}/${crypto.randomUUID()}-${data.filename}`;

    const hash = crypto.createHash('sha256');
    const hashed = data.file.pipe(hashingStream(hash));
    data.file.on('error', (err: Error) => hashed.destroy(err));

    let objectInfo;
    try {
      objectInfo = await storage.upload(objectKey, hashed, data.mimetype);
    } catch (err) {
      request.log.error(err, 'Failed to upload file to storage');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process file' } });
    }

    const fileHash = hash.digest('hex');
    const fileSizeBytes = objectInfo.sizeBytes;

    const version = await docRepo.createNewVersion(orgId, id, {
      filePath: objectKey,
      fileHash,
      fileSizeBytes,
    });

    const doc = await docRepo.updateFileInfo(orgId, id, { fileHash, fileSizeBytes, status: 'uploaded' });

    const jobId = crypto.randomUUID();
    try {
      await jobRepo.create(orgId, {
        id: jobId,
        documentId: id,
        versionId: version.id,
        orgId,
        status: 'pending',
        idempotencyKey: crypto.randomUUID()
      });
    } catch (err) {
      request.log.error(err, 'Failed to create job tracking record');
    }

    const job = await ingestionQueue.add(
      'ingest-document',
      {
        jobId,
        documentId: id,
        versionId: version.id,
        orgId,
        filePath: objectKey,
        fileType: existingDoc.fileType,
      },
      {
        jobId: crypto.randomUUID(),
      }
    );

    return reply.status(201).send({ data: doc, version, jobId: job.id });
  });

  // List a document's version history
  fastify.get('/:id/versions', {
    preHandler: requirePermissionMiddleware('documents:read'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const doc = await docRepo.findById(orgId, id);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const versions = await docRepo.listVersions(orgId, id);
    return { data: versions };
  });

  // Rename a document (display name only — the stored object and file type are unchanged)
  fastify.patch('/:id', {
    preHandler: requirePermissionMiddleware(['documents:update', 'documents:update:own']),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const { name } = (request.body ?? {}) as { name?: unknown };
    const trimmed = typeof name === 'string' ? name.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (!trimmed || trimmed.length > 500 || /[\\/\x00-\x1f]/.test(trimmed)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'name must be 1-500 characters without slashes or control characters' } });
    }

    const target = await docRepo.findById(orgId, id);
    if (!target) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }
    if (denyIfNotAllowed(request, reply, 'update', target.uploadedBy)) return;

    const doc = await docRepo.rename(orgId, id, trimmed);
    // Cached chat answers embed the old name in their citations.
    await bumpCacheVersion(orgId);
    return { data: doc };
  });

  // Move a document
  fastify.patch('/:id/move', {
    preHandler: requirePermissionMiddleware(['documents:update', 'documents:update:own']),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const { folderId } = request.body as { folderId: string | null };
    const target = await docRepo.findById(orgId, id);
    if (!target) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }
    if (denyIfNotAllowed(request, reply, 'update', target.uploadedBy)) return;
    if (folderId != null) {
      // The destination must be a folder in *this* library, never another tenant's.
      const folder = await folderRepo.getById(orgId, folderId).catch(() => null);
      if (!folder) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Folder not found' } });
      }
    }
    const doc = await docRepo.move(orgId, id, folderId);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    return { data: doc };
  });

  // Update document notes
  fastify.patch('/:id/notes', {
    preHandler: requirePermissionMiddleware(['documents:update', 'documents:update:own']),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const { notes } = request.body as { notes: string | null };
    const target = await docRepo.findById(orgId, id);
    if (!target) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }
    if (denyIfNotAllowed(request, reply, 'update', target.uploadedBy)) return;

    const doc = await docRepo.updateNotes(orgId, id, notes);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    return { data: doc };
  });

  // Delete a document
  fastify.delete('/:id', {
    preHandler: requirePermissionMiddleware(['documents:delete', 'documents:delete:own']),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    if (!id) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing document ID' } });
    }

    const target = await docRepo.findById(orgId, id);
    if (!target) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }
    if (denyIfNotAllowed(request, reply, 'delete', target.uploadedBy)) return;

    try {
      const deletedDoc = await docRepo.softDelete(orgId, id);
      if (!deletedDoc) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
      }
      await bumpCacheVersion(orgId);
      return { success: true };
    } catch (err) {
      request.log.error(err, 'Failed to delete document');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete document' } });
    }
  });
  // Get document content
  fastify.get('/:id/content', {
    preHandler: requirePermissionMiddleware('documents:read'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };

    const doc = await docRepo.findById(orgId, id);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const version = await docRepo.getActiveVersion(orgId, id);
    if (!version || !version.filePath) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File not found' } });
    }

    try {
      let stream;
      try {
        stream = await storage.download(version.filePath);
      } catch {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File is missing from storage' } });
      }

      let contentType = 'application/octet-stream';
      if (doc.fileType === 'pdf') contentType = 'application/pdf';
      else if (doc.fileType === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (doc.fileType === 'txt') contentType = 'text/plain';
      else if (doc.fileType === 'md') contentType = 'text/markdown';
      // Uploaded HTML is served as plain text: members of a shared library can view each
      // other's files, and rendering it would let one member run script as another.
      else if (doc.fileType === 'html') contentType = 'text/plain';
      else if (doc.fileType && doc.fileType.includes('image')) contentType = `image/${doc.fileType.replace('image/', '')}`;

      reply.header('Content-Type', contentType);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
      
      // Safely encode filename to prevent HTTP header character errors
      const safeFileName = encodeURIComponent(doc.fileName);
      reply.header('Content-Disposition', `inline; filename*=UTF-8''${safeFileName}`);
      return reply.send(stream);
    } catch (err) {
      request.log.error(err, 'Failed to read file');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read file' } });
    }
  });
};
