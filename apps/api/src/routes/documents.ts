import { FastifyPluginAsync } from 'fastify';
import '@fastify/multipart';
import { requirePermissionMiddleware } from '@rag/auth';
import { DocumentRepository, JobRepository, db, documentVersions, users, organizations } from '@rag/database';
import { ingestionQueue } from '../queue.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const docRepo = new DocumentRepository();
const jobRepo = new JobRepository();

// Define allowed mime types per our implementation plan
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/html'
];

export const documentRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all documents
  fastify.get('/', {
    preHandler: requirePermissionMiddleware('documents:read'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { limit, offset, folderId } = request.query as any;
    const parsedFolderId = folderId === 'null' ? null : (folderId || undefined);
    const docs = await docRepo.list(orgId, parseInt(limit) || 20, parseInt(offset) || 0, parsedFolderId);
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
    
    const userId = request.user?.id;
    if (userId) {
      try {
        await db.insert(users).values({
          id: userId,
          email: request.user?.email || `user-${userId}@example.com`,
          fullName: request.user?.email || 'User',
        }).onConflictDoNothing();
        
        await db.insert(organizations).values({
          id: orgId,
          name: 'Personal Workspace',
          slug: `personal-${orgId}`,
        }).onConflictDoNothing();
      } catch (err) {
        request.log.error(err, 'Failed to upsert user and org');
      }
    }

    const data = await (request as any).file();
    if (!data) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'No file uploaded' } });
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: `Unsupported file type: ${data.mimetype}` } });
    }

    // In a real implementation, we stream to S3/GCS.
    // For this local foundation, we save to disk in a temporary directory
    const uploadDir = path.join(process.cwd(), 'tmp', 'uploads', orgId);
    await fs.promises.mkdir(uploadDir, { recursive: true });
    
    // Hash the file as we write it
    const hash = crypto.createHash('sha256');
    const tempFilePath = path.join(uploadDir, `${crypto.randomUUID()}-${data.filename}`);
    const writeStream = fs.createWriteStream(tempFilePath);

    data.file.on('data', (chunk: Buffer) => hash.update(chunk));
    
    try {
      await pipeline(data.file, writeStream);
    } catch (err) {
      request.log.error(err, 'Failed to save file');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process file' } });
    }

    const fileHash = hash.digest('hex');
    const stats = await fs.promises.stat(tempFilePath);
    const fileSizeBytes = stats.size;

    const fileType = data.mimetype.includes('pdf') ? 'pdf' :
                     data.mimetype.includes('word') ? 'docx' :
                     data.mimetype.includes('html') ? 'html' :
                     data.mimetype.includes('markdown') ? 'md' : 'txt';

    const folderId = data.fields?.folderId?.value;

    // Create Document record in DB
    const doc = await docRepo.create(orgId, {
      orgId,
      title: data.filename,
      fileName: data.filename,
      fileType,
      fileSizeBytes,
      fileHash,
      status: 'uploaded',
      folderId: folderId === 'null' ? null : (folderId as string || null),
      uploadedBy: request.user?.id,
      metadata: {},
    });

    if (!doc) {
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create document record' } });
    }

    // We assume version creation happens here in a full flow.
    // For Phase 4/5 testing, we need to create a document_versions record so that chunk insertion doesn't fail due to FK constraints.
    // We use the documentId as versionId for our simple test phase
    const versionId = doc.id;
    await db.insert(documentVersions).values({
      id: versionId,
      documentId: doc.id,
      orgId: doc.orgId,
      versionNumber: 1,
      filePath: tempFilePath,
      fileHash,
      fileSizeBytes,
      isActive: true,
    });
    
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
        filePath: tempFilePath,
        fileType,
      },
      {
        jobId: crypto.randomUUID(), // unique bullmq id
      }
    );

    return reply.status(201).send({ data: doc, jobId: job.id });
  });

  // Move a document
  fastify.patch('/:id/move', {
    preHandler: requirePermissionMiddleware('documents:update'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const { folderId } = request.body as { folderId: string | null };

    const doc = await docRepo.move(orgId, id, folderId);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    return { data: doc };
  });

  // Update document notes
  fastify.patch('/:id/notes', {
    preHandler: requirePermissionMiddleware('documents:update'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    const { notes } = request.body as { notes: string | null };

    const doc = await docRepo.updateNotes(orgId, id, notes);
    if (!doc) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    return { data: doc };
  });

  // Delete a document
  fastify.delete('/:id', {
    preHandler: requirePermissionMiddleware('documents:delete'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    const { id } = request.params as { id: string };
    if (!id) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing document ID' } });
    }

    try {
      const deletedDoc = await docRepo.softDelete(orgId, id);
      if (!deletedDoc) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
      }
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
      let actualPath = version.filePath;
      if (actualPath.includes('tmp/uploads/')) {
        const relative = actualPath.substring(actualPath.indexOf('tmp/uploads/'));
        actualPath = path.join(process.cwd(), relative);
      }
      
      try {
        await fs.promises.access(actualPath);
      } catch (err) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'File is missing from server' } });
      }

      const stream = fs.createReadStream(actualPath);
      
      let contentType = 'application/octet-stream';
      if (doc.fileType === 'pdf') contentType = 'application/pdf';
      else if (doc.fileType === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (doc.fileType === 'txt') contentType = 'text/plain';
      else if (doc.fileType === 'md') contentType = 'text/markdown';
      else if (doc.fileType === 'html') contentType = 'text/html';
      else if (doc.fileType && doc.fileType.includes('image')) contentType = `image/${doc.fileType.replace('image/', '')}`;

      reply.header('Content-Type', contentType);
      
      // Safely encode filename to prevent HTTP header character errors
      const safeFileName = encodeURIComponent(doc.fileName);
      reply.header('Content-Disposition', `inline; filename*=UTF-8''${safeFileName}`);
      return reply.send(stream);
    } catch (err: any) {
      request.log.error(err, 'Failed to read file');
      return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message, stack: err.stack } });
    }
  });
};
