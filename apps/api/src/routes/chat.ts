import { FastifyPluginAsync } from 'fastify';
import { requirePermissionMiddleware } from '@rag/auth';
import { db, conversations, messages, citations, ChunkRepository, users, organizations, eq } from '@rag/database';
import { GeminiEmbeddingProvider, GeminiLLMProvider, CohereRerankerProvider, LLMMessage } from '@rag/providers';
import crypto from 'crypto';

const chunkRepo = new ChunkRepository();

// Lazy-initialize providers to avoid crashes when env vars aren't loaded at import time
let embeddingProvider: GeminiEmbeddingProvider;
let llmProvider: GeminiLLMProvider;
let rerankerProvider: CohereRerankerProvider | null = null;

function getEmbeddingProvider() {
  if (!embeddingProvider) embeddingProvider = new GeminiEmbeddingProvider();
  return embeddingProvider;
}

function getLlmProvider() {
  if (!llmProvider) llmProvider = new GeminiLLMProvider();
  return llmProvider;
}

function getRerankerProvider(): CohereRerankerProvider | null {
  if (rerankerProvider) return rerankerProvider;
  try {
    rerankerProvider = new CohereRerankerProvider();
    return rerankerProvider;
  } catch (err) {
    console.warn('CohereRerankerProvider not available (COHERE_API_KEY missing?), reranking disabled');
    return null;
  }
}
export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/completions', {
    preHandler: requirePermissionMiddleware('chat:create'),
  }, async (request, reply) => {
    const orgId = request.user?.orgId || request.user?.id;
    if (!orgId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User does not belong to an organization' } });
    }
    
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'User ID is required' } });
    }

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

    const { messages: incomingMessages, stream, conversationId: reqConversationId, documentIds } = request.body as any;
    if (!incomingMessages || !Array.isArray(incomingMessages) || incomingMessages.length === 0) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing or empty messages array' } });
    }

    let conversationId = reqConversationId;
    let isNewConversation = false;

    if (documentIds !== undefined) {
      if (!Array.isArray(documentIds)) {
        return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'documentIds must be an array' } });
      }
      for (const id of documentIds) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid document ID format' } });
        }
      }
    }

    if (conversationId) {
      const existing = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationId)
      });
      if (!existing) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
      }
    } else {
      conversationId = crypto.randomUUID();
      isNewConversation = true;
    }

    const lastMessage = incomingMessages[incomingMessages.length - 1];
    if (lastMessage.role !== 'user') {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Last message must be from user' } });
    }

    const userQuery = lastMessage.content;

    let standaloneQuery = userQuery;
    
    // Only rewrite query if there is conversation history
    if (incomingMessages.length > 1) {
      const rewritePrompt = `Given the following conversation history and the user's latest follow-up question, rewrite the follow-up question to be a standalone query that can be used to search a vector database for relevant documents. Do not answer the question, ONLY return the standalone query.

Conversation History:
${incomingMessages.slice(0, -1).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}

Latest Question: ${userQuery}

Standalone Query:`;
      
      try {
        const rewriteLlm = new GeminiLLMProvider(undefined, 'gemini-2.5-flash');
        const rewriteResponse = await rewriteLlm.generate([{ role: 'user', content: rewritePrompt }]);
        if (rewriteResponse.content.trim()) {
          standaloneQuery = rewriteResponse.content.trim();
          request.log.info({ original: userQuery, rewritten: standaloneQuery }, 'Rewrote query for vector search');
        }
      } catch (err) {
        request.log.warn(err, 'Failed to rewrite query, falling back to original');
      }
    }

    // 1. Embed the query
    const queryEmbedding = await getEmbeddingProvider().embedQuery(standaloneQuery);

    // 2. Search for relevant chunks
    const initialCandidates = await chunkRepo.searchSimilar(orgId, queryEmbedding, 15, 0.4, documentIds);

    let searchResults = initialCandidates;
    
    // 3. Rerank if there are results
    if (initialCandidates.length > 0) {
      const reranker = getRerankerProvider();
      if (reranker) {
        const documentsText = initialCandidates.map(c => c.chunk.content);
        try {
          const reranked = await reranker.rerank(standaloneQuery, documentsText, 5);
          searchResults = reranked
            .filter(r => r.relevanceScore >= 0.3) // THRESHOLD FILTER
            .map(r => {
              const item = initialCandidates[r.index]!;
              return {
                chunk: item.chunk,
                document: item.document,
                similarity: r.relevanceScore
              };
            });
        } catch (err) {
          request.log.warn(err, 'Reranking failed, falling back to original vector search order');
          searchResults = initialCandidates.slice(0, 5);
        }
      } else {
        searchResults = initialCandidates.slice(0, 5);
      }
    }

    // 4. Assemble context
    let contextText = '';
    const uniqueDocs = new Set<string>();
    searchResults.forEach((res, index) => {
      uniqueDocs.add(res.document.title);
      contextText += `\n[Citation ${index + 1}] Source: ${res.document.title}\n${res.chunk.content}\n`;
    });

    const systemPrompt = `You are an expert AI assistant. Follow these instructions strictly:
1. Answer the user's questions based ONLY on the provided context.
2. If the answer is not in the context, politely state that you cannot find the answer in the provided documents.
3. However, you MUST try to answer conversational greetings normally.
4. When you provide facts from the context, you MUST cite your sources using the [Citation N] format.
5. Think step-by-step internally before answering to ensure your response is logically sound and accurate.
    
Context:
${contextText}`;

    // 5. Build LLM prompt
    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...incomingMessages.map((m: any) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content }))
    ];

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();

    if (isNewConversation) {
      try {
        await db.insert(conversations).values({
          id: conversationId,
          orgId,
          userId: userId as string,
          title: 'New Conversation',
        });
      } catch (err) {
        request.log.error(err, 'Failed to create conversation entry in DB');
      }
    }

    const saveToDb = async (fullContent: string, usage: any, latencyMs: number) => {
      try {

        await db.insert(messages).values({
          id: userMessageId,
          conversationId,
          orgId,
          role: 'user',
          content: userQuery,
        });

        await db.insert(messages).values({
          id: assistantMessageId,
          conversationId,
          orgId,
          role: 'assistant',
          content: fullContent,
          model: getLlmProvider().model,
          tokenCount: usage?.total_tokens || 0,
          latencyMs,
        });

        if (isNewConversation) {
          getLlmProvider().generate([{ 
            role: 'user', 
            content: `Generate a very short, concise title (max 5 words) for a conversation that starts with this message: "${userQuery}". Do not use quotes or prefixes.` 
          }]).then(async (titleResponse) => {
            const title = titleResponse.content.trim().replace(/^["']|["']$/g, '');
            await db.update(conversations)
              .set({ title })
              .where(eq(conversations.id, conversationId));
          }).catch(titleErr => {
            request.log.warn(titleErr, 'Failed to generate title');
          });
        }

        if (searchResults.length > 0) {
          // Extract used citations from the generated content
          const usedCitationIndices = new Set<number>();
          const matches = fullContent.matchAll(/\[Citation\s*(\d+)\]/gi);
          for (const match of matches) {
            if (match[1]) {
              const index = parseInt(match[1], 10);
              usedCitationIndices.add(index);
            }
          }
          
          const usedSearchResults = searchResults
            .map((res, i) => ({ res, index: i + 1 }))
            .filter(item => usedCitationIndices.has(item.index));

          if (usedSearchResults.length > 0) {
            const citationRecords = usedSearchResults.map(({res, index}) => ({
              id: crypto.randomUUID(),
              messageId: assistantMessageId,
              chunkId: res.chunk.id,
              documentId: res.document.id,
              orgId,
              citationIndex: index,
              relevanceScore: res.similarity as number,
              snippet: res.chunk.content.substring(0, 200),
            }));
            await db.insert(citations).values(citationRecords);
          }
        }
      } catch (err) {
        request.log.error(err, 'Failed to save chat to DB');
      }
    };
    const citationsOutput = searchResults.map((res, index) => ({
      index: index + 1,
      document: res.document.title,
      documentId: res.document.id,
      fileName: res.document.fileName,
      fileType: res.document.fileType,
      score: res.similarity,
      snippet: res.chunk.content.substring(0, 100) + '...',
    }));

    if (stream) {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': request.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true'
      });

      reply.raw.write(`data: ${JSON.stringify({ type: 'meta', conversationId })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: 'citations', citations: citationsOutput })}\n\n`);

      let fullContent = '';
      let finalUsage = undefined;
      const startMs = Date.now();

      try {
        const streamIterable = getLlmProvider().generateStream(llmMessages);
        for await (const chunk of streamIterable) {
          if (chunk.content) {
            fullContent += chunk.content;
            reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content })}\n\n`);
          }
          if (chunk.usage) {
            finalUsage = chunk.usage;
          }
        }
      } catch (err: any) {
        request.log.error(err, 'Streaming failed');
        const errMsg = err.message ? err.message : 'Generation failed';
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
      }

      const latencyMs = Date.now() - startMs;
      await saveToDb(fullContent, finalUsage, latencyMs);

      reply.raw.write(`data: [DONE]\n\n`);
      reply.raw.end();
      return;
    }

    // Non-streaming fallback
    const llmResponse = await getLlmProvider().generate(llmMessages);
    await saveToDb(llmResponse.content, llmResponse.usage, llmResponse.latency_ms);

    return reply.status(200).send({
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: llmResponse.content,
      citations: citationsOutput,
      usage: llmResponse.usage,
    });
  });
};
