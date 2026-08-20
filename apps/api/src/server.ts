import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { authenticate } from '@rag/auth';
import { documentRoutes } from './routes/documents.js';
import { chatRoutes } from './routes/chat.js';
import { conversationsRoutes } from './routes/conversations.js';
import folderRoutes from './routes/folders.js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

export function buildServer(): FastifyInstance {
  const server = fastify({
    ignoreTrailingSlash: true,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    // Required for large file uploads
    bodyLimit: parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024,
  });

  // Plugins
  server.register(cors, {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
  });
  
  server.register(multipart, {
    limits: {
      fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024,
    },
  });

  // Global Auth Decorators
  server.decorateRequest('user', null);
  server.decorateRequest('userRole', null);

  // Health check
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // API Routes (v1)
  server.register(async (api) => {
    // Add auth hook for all routes in this context
    api.addHook('onRequest', authenticate);
    
    api.register(documentRoutes, { prefix: '/documents' });
    api.register(chatRoutes, { prefix: '/chat' });
    api.register(conversationsRoutes, { prefix: '/conversations' });
    api.register(folderRoutes, { prefix: '/folders' });
  }, { prefix: '/api/v1' });

  return server;
}
