import { FastifyPluginAsync } from 'fastify';
import { requirePermissionMiddleware } from '@rag/auth';
import { db, conversations, messages, eq, desc, and } from '@rag/database';

export const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all conversations for a user
  fastify.get('/', {
    preHandler: requirePermissionMiddleware('chat:read'), // Assuming 'chat:read' or similar permission exists
  }, async (request, reply) => {
    const userId = request.user?.id;
    const orgId = request.user?.orgId || request.user?.id;

    if (!userId || !orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    try {
      const userConversations = await db.select()
        .from(conversations)
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.orgId, orgId),
            eq(conversations.isArchived, false)
          )
        )
        .orderBy(desc(conversations.createdAt));

      return reply.status(200).send({ data: userConversations });
    } catch (error) {
      request.log.error(error, 'Failed to fetch conversations');
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch conversations' } });
    }
  });

  // Get messages for a conversation
  fastify.get('/:id/messages', {
    preHandler: requirePermissionMiddleware('chat:read'),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user?.orgId || request.user?.id;
    const userId = request.user?.id;

    if (!orgId || !userId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    try {
      // Ensure conversation exists and belongs to user
      const conversation = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, id),
          eq(conversations.orgId, orgId),
          eq(conversations.userId, userId)
        )
      });

      if (!conversation) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
      }

      // Fetch messages
      const conversationMessages = await db.query.messages.findMany({
        where: eq(messages.conversationId, id),
        orderBy: (messages, { asc }) => [asc(messages.createdAt)]
      });

      // Fetch citations for these messages
      const messageIds = conversationMessages.map(m => m.id);
      
      let messageCitations: any[] = [];
      if (messageIds.length > 0) {
        // Find citations and join with document title
        messageCitations = await db.query.citations.findMany({
          where: (citations, { inArray }) => inArray(citations.messageId, messageIds),
          with: {
            document: {
              columns: {
                title: true
              }
            }
          }
        });
      }

      // Format response
      const formattedMessages = conversationMessages.map(m => {
        const citationsForMsg = messageCitations.filter(c => c.messageId === m.id).map(c => ({
          index: c.citationIndex,
          documentTitle: c.document?.title || 'Unknown Document',
          score: c.relevanceScore,
          snippet: c.snippet
        }));

        return {
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          citations: citationsForMsg.length > 0 ? citationsForMsg : undefined
        };
      });

      return reply.status(200).send({ 
        conversation,
        messages: formattedMessages 
      });
    } catch (error) {
      request.log.error(error, 'Failed to fetch conversation messages');
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch conversation messages' } });
    }
  });

  // Delete a conversation
  fastify.delete('/:id', {
    preHandler: requirePermissionMiddleware('chat:create'),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user?.orgId || request.user?.id;
    const userId = request.user?.id;

    if (!orgId || !userId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }

    try {
      const result = await db.delete(conversations)
        .where(
          and(
            eq(conversations.id, id),
            eq(conversations.orgId, orgId),
            eq(conversations.userId, userId)
          )
        )
        .returning({ deletedId: conversations.id });

      if (result.length === 0) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Conversation not found or you do not have permission to delete it' } });
      }

      return reply.status(200).send({ success: true, deletedId: result[0]?.deletedId });
    } catch (error) {
      request.log.error(error, 'Failed to delete conversation');
      return reply.status(500).send({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete conversation' } });
    }
  });
};
