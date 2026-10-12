import { FastifyPluginAsync } from 'fastify';
import { requirePermissionMiddleware } from '@rag/auth';
import { db, conversations, messages, citations, ChunkRepository, eq, and } from '@rag/database';
import { NvidiaEmbeddingProvider, CloudflareLLMProvider, CohereRerankerProvider, LLMMessage, getLangfuse, flushLangfuse } from '@rag/providers';
import type { ScoredChunk } from '@rag/core';
import crypto from 'crypto';
import { redisConnection } from '../queue.js';
import { ragPipelineDuration, ragCacheHits } from '../plugins/metrics.js';

const chunkRepo = new ChunkRepository();

// Lazy-initialize providers to avoid crashes when env vars aren't loaded at import time
let embeddingProvider: NvidiaEmbeddingProvider;
let llmProvider: CloudflareLLMProvider;
let rerankerProvider: CohereRerankerProvider | null = null;

function getEmbeddingProvider() {
  if (!embeddingProvider) embeddingProvider = new NvidiaEmbeddingProvider();
  return embeddingProvider;
}

function getLlmProvider() {
  if (!llmProvider) llmProvider = new CloudflareLLMProvider();
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

type ChunkSearchResult = { chunk: { id: string; content: string; documentId: string; [k: string]: any }; document: any };

/**
 * Merges dense (pgvector) and full-text (BM25-ish) candidate lists by
 * Reciprocal Rank Fusion. RRF combines rankings rather than raw scores, which
 * matters here because cosine similarity and ts_rank_cd are not on comparable
 * scales — naive score averaging would let whichever one happens to produce
 * larger numbers dominate.
 */
function reciprocalRankFusion(
  listA: ChunkSearchResult[],
  listB: ChunkSearchResult[],
  k: number = 60
): (ChunkSearchResult & { similarity: number })[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, ChunkSearchResult>();

  for (const list of [listA, listB]) {
    list.forEach((item, rank) => {
      if (!byId.has(item.chunk.id)) byId.set(item.chunk.id, item);
      scores.set(item.chunk.id, (scores.get(item.chunk.id) || 0) + 1 / (k + rank + 1));
    });
  }

  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([id, score]) => ({ chunk: byId.get(id)!.chunk, document: byId.get(id)!.document, similarity: score }));
}
/** CORS headers for hijacked SSE responses (Fastify's cors plugin doesn't run after hijack). */
function sseCorsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim());
  if (!allowed) return { 'Access-Control-Allow-Origin': '*' };
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
    : {};
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

    // User/org/membership provisioning for the personal-workspace fallback now
    // happens centrally in the `authenticate` middleware (packages/auth) — see
    // ensurePersonalWorkspace there.

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
      // Scoped to this org AND user: otherwise anyone who learns a conversation id
      // could append messages to someone else's chat.
      const existing = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          eq(conversations.orgId, orgId),
          eq(conversations.userId, userId as string)
        )
      });
      if (!existing) {
        request.log.info({ conversationId }, "Returning 404 because conversation was not found in DB");
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

    // Rate Limiting
    try {
      const rateLimitKey = `rate-limit:chat:${orgId}:${userId}`;
      const currentLimit = await redisConnection.incr(rateLimitKey);
      if (currentLimit === 1) {
        await redisConnection.expire(rateLimitKey, 60); // 1 minute window
      }
      if (currentLimit > 20) {
        return reply.status(429).send({ error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Please try again in a minute.' } });
      }
    } catch (err) {
      request.log.warn(err, 'Rate limiting failed, allowing request');
    }

    const userQuery = lastMessage.content;
    const trace = getLangfuse().trace({
      name: "chat-completion",
      sessionId: conversationId,
      userId: userId as string,
      tags: ["RAG"],
      input: userQuery
    });

    const rootSpan = trace.span({
      name: "chat-interaction",
      input: userQuery
    });

    // Cache Check
    const docIdsStr = Array.isArray(documentIds) && documentIds.length ? [...documentIds].sort().join(',') : 'all';
    const queryHash = crypto.createHash('sha256').update(userQuery.toLowerCase().trim()).digest('hex');
    // The org's cache version is bumped whenever its knowledge changes (a document
    // finishes indexing or is deleted), so teammates' uploads and deletions show up
    // immediately instead of after the 1h TTL.
    let cacheVersion = '0';
    try {
      cacheVersion = (await redisConnection.get(`rag:cache-version:${orgId}`)) ?? '0';
    } catch { /* cache is best-effort */ }
    const cacheKey = `cache:chat:org:${orgId}:v${cacheVersion}:docs:${docIdsStr}:query:${queryHash}`;

    try {
      const cachedResult = await redisConnection.get(cacheKey);
      if (cachedResult) {
        const parsedCache = JSON.parse(cachedResult);

        // A cached answer must still become part of the conversation, otherwise a
        // brand-new conversationId is returned that doesn't exist in the DB and the
        // next turn 404s.
        try {
          if (isNewConversation) {
            await db.insert(conversations).values({ id: conversationId, orgId, userId: userId as string, title: userQuery.trim().slice(0, 60) || 'New Conversation' });
          }
          await db.insert(messages).values([
            { id: crypto.randomUUID(), conversationId, orgId, role: 'user', content: userQuery },
            { id: crypto.randomUUID(), conversationId, orgId, role: 'assistant', content: parsedCache.content, model: 'cache', tokenCount: 0, latencyMs: 0 },
          ]);
        } catch (persistErr) {
          request.log.error(persistErr, 'Failed to persist cached chat turn');
        }

        // Log cache hit
        request.log.info({ cacheKey }, 'Query Cache Hit');
        ragCacheHits.inc();

        if (stream) {
          reply.hijack();
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...sseCorsHeaders(request.headers.origin)
          });

          reply.raw.write(`data: ${JSON.stringify({ type: 'meta', conversationId })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: 'citations', citations: parsedCache.citations })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', content: parsedCache.content })}\n\n`);
          reply.raw.write(`data: [DONE]\n\n`);
          reply.raw.end();

          rootSpan.end({ output: parsedCache.content });
          trace.update({ output: parsedCache.content });
          flushLangfuse();
          return;
        } else {
          rootSpan.end({ output: parsedCache.content });
          trace.update({ output: parsedCache.content });
          flushLangfuse();
          return reply.status(200).send({
            id: crypto.randomUUID(),
            conversationId,
            role: 'assistant',
            content: parsedCache.content,
            citations: parsedCache.citations,
            cached: true
          });
        }
      }
    } catch (err) {
      request.log.warn(err, 'Cache check failed, proceeding to RAG pipeline');
    }

    let standaloneQuery = userQuery;

    // Only rewrite query if there is conversation history
    if (incomingMessages.length > 1) {
      const rewritePrompt = `Given the following conversation history and the user's latest follow-up question, rewrite the follow-up question to be a standalone query that can be used to search a vector database for relevant documents. Do not answer the question, ONLY return the standalone query.

Conversation History:
${incomingMessages.slice(0, -1).map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}

Latest Question: ${userQuery}

Standalone Query:`;

      try {
        const rewriteLlm = new CloudflareLLMProvider(undefined, undefined, '@cf/meta/llama-3.1-8b-instruct');
        const rewriteGen = rootSpan.generation({ name: "query-rewrite", model: "@cf/meta/llama-3.1-8b-instruct", input: rewritePrompt });
        const rewriteResponse = await rewriteLlm.generate([{ role: 'user', content: rewritePrompt }]);
        rewriteGen.end({ output: rewriteResponse.content });
        if (rewriteResponse.content.trim()) {
          standaloneQuery = rewriteResponse.content.trim();
          request.log.info({ original: userQuery, rewritten: standaloneQuery }, 'Rewrote query for vector search');
        }
      } catch (err) {
        request.log.warn(err, 'Failed to rewrite query, falling back to original');
      }
    }

    const retrievalSpan = rootSpan.span({ name: "hybrid-retrieval", input: standaloneQuery });
    const retrievalStartMs = Date.now();
    // 1. Embed the query
    const queryEmbedding = await getEmbeddingProvider().embedQuery(standaloneQuery);

    // 2. Hybrid retrieval: dense (pgvector cosine) + full-text (Postgres BM25-ish),
    // run in parallel and merged with Reciprocal Rank Fusion. Catches both
    // semantic matches and exact-terminology matches (policy numbers, product
    // codes, etc.) that dense-only search misses.
    const [denseResults, fullTextResults] = await Promise.all([
      chunkRepo.searchSimilar(orgId, queryEmbedding, 20, 0.2, documentIds),
      chunkRepo.searchFullText(orgId, standaloneQuery, 20, documentIds),
    ]);
    const initialCandidates = reciprocalRankFusion(denseResults, fullTextResults).slice(0, 20);

    let searchResults: (ChunkSearchResult & { similarity: number })[] = initialCandidates;
    retrievalSpan.end({ output: initialCandidates.map(c => c.chunk.content) });
    ragPipelineDuration.observe({ stage: 'retrieval' }, (Date.now() - retrievalStartMs) / 1000);

    // 3. Rerank if there are results
    const rerankSpan = initialCandidates.length > 0 ? rootSpan.span({ name: "reranking", input: standaloneQuery }) : null;
    if (initialCandidates.length > 0) {
      const reranker = getRerankerProvider();
      if (reranker) {
        const candidates: ScoredChunk[] = initialCandidates.map(c => ({
          id: c.chunk.id,
          content: c.chunk.content,
          documentId: c.chunk.documentId,
          score: c.similarity,
        }));
        try {
          const reranked = await reranker.rerank(standaloneQuery, candidates, 5);
          searchResults = reranked
            .filter(r => (r.score ?? 0) >= 0.15) // THRESHOLD FILTER
            .map(r => {
              const item = initialCandidates.find(c => c.chunk.id === r.id)!;
              return {
                chunk: item.chunk,
                document: item.document,
                similarity: r.score ?? 0,
              };
            });
        } catch (err) {
          request.log.warn(err, 'Reranking failed, falling back to fused hybrid-search order');
          searchResults = initialCandidates.slice(0, 5);
        }
        if (rerankSpan) rerankSpan.end({ output: searchResults.map(r => r.chunk.content) });
      } else {
        searchResults = initialCandidates.slice(0, 5);
        if (rerankSpan) rerankSpan.end({ output: searchResults.map(r => r.chunk.content) });
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

    const mainGen = rootSpan.generation({
      name: "main-llm-response",
      model: getLlmProvider().model,
      input: systemPrompt
    });
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
            const citationRecords = usedSearchResults.map(({ res, index }) => ({
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

    const saveToCache = async (content: string, citationsOutput: any) => {
      try {
        const cacheData = JSON.stringify({ content, citations: citationsOutput });
        await redisConnection.setex(cacheKey, 3600, cacheData); // 1 hour TTL
      } catch (err) {
        request.log.warn(err, 'Failed to save to Redis cache');
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
        ...sseCorsHeaders(request.headers.origin)
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
      ragPipelineDuration.observe({ stage: 'generation' }, latencyMs / 1000);
      mainGen.end({
        output: fullContent,
        usage: finalUsage ? { promptTokens: finalUsage.prompt_tokens, completionTokens: finalUsage.completion_tokens, totalTokens: finalUsage.total_tokens } : undefined
      });
      rootSpan.end({ output: fullContent });
      trace.update({ output: fullContent });
      flushLangfuse();
      await saveToDb(fullContent, finalUsage, latencyMs);
      await saveToCache(fullContent, citationsOutput);

      reply.raw.write(`data: [DONE]\n\n`);
      reply.raw.end();
      return;
    }

    // Non-streaming fallback
    const llmResponse = await getLlmProvider().generate(llmMessages);
    await saveToDb(llmResponse.content, llmResponse.usage, llmResponse.latency_ms);
    mainGen.end({
      output: llmResponse.content,
      usage: llmResponse.usage ? { promptTokens: llmResponse.usage.prompt_tokens, completionTokens: llmResponse.usage.completion_tokens, totalTokens: llmResponse.usage.total_tokens } : undefined
    });
    rootSpan.end({ output: llmResponse.content });
    trace.update({ output: llmResponse.content });
    flushLangfuse();

    await saveToCache(llmResponse.content, citationsOutput);

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
