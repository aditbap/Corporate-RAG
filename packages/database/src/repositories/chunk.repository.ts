import { BaseRepository } from './base.repository.js';
import { documentChunks } from '../schema/chunks.js';
import { documents } from '../schema/documents.js';
import crypto from 'crypto';
import { sql, desc, and, eq, ne, gte, inArray } from 'drizzle-orm';

export class ChunkRepository extends BaseRepository {
  constructor() {
    super('document_chunks');
  }

  async insertChunks(orgId: string, documentId: string, versionId: string, chunks: { text: string, embedding: number[], metadata?: any }[], embeddingModel: string) {
    if (chunks.length === 0) return [];

    // We insert in batches if needed, but for now we assume chunks array is a manageable size
    const records = chunks.map((chunk, index) => {
      const hash = crypto.createHash('sha256').update(chunk.text).digest('hex');
      return {
        orgId,
        documentId,
        versionId,
        chunkIndex: index,
        content: chunk.text,
        contentHash: hash,
        tokenCount: Math.round(chunk.text.length / 4), // rough estimate
        metadata: chunk.metadata || {},
        embedding: chunk.embedding,
        embeddingModel
      };
    });

    const result = await this.db.insert(documentChunks).values(records).returning();
    return result;
  }

  /**
   * Deactivates chunks from any version of this document OTHER than
   * `keepVersionId`. Called after a new version's chunks finish indexing, so a
   * document never has two versions' worth of chunks searchable at once.
   */
  async deactivateOtherVersions(orgId: string, documentId: string, keepVersionId: string) {
    await this.db.update(documentChunks)
      .set({ isActive: false })
      .where(and(
        eq(documentChunks.orgId, orgId),
        eq(documentChunks.documentId, documentId),
        ne(documentChunks.versionId, keepVersionId)
      ));
  }

  async searchSimilar(orgId: string, embedding: number[], limit: number = 5, minSimilarity: number = 0.5, documentIds?: string[]) {
    // cosine distance: 1 - cosine_similarity. So lower distance is more similar.
    // Drizzle pgvector has <=> operator for cosine distance.
    const similarity = sql`1 - (${documentChunks.embedding} <=> ${JSON.stringify(embedding)}::vector)`;
    
    const conditions = [
      eq(documentChunks.orgId, orgId),
      eq(documentChunks.isActive, true),
      eq(documents.isDeleted, false),
      gte(similarity, minSimilarity)
    ];

    if (documentIds && documentIds.length > 0) {
      conditions.push(inArray(documentChunks.documentId, documentIds));
    }

    const results = await this.db
      .select({
        chunk: documentChunks,
        document: documents,
        similarity: similarity,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(and(...conditions))
      .orderBy(desc(similarity))
      .limit(limit);

    return results;
  }

  /**
   * Full-text (BM25-ish) search using Postgres's built-in text search. Ranked
   * with ts_rank_cd (cover density — rewards matched terms appearing close
   * together) rather than plain ts_rank. Relies on the functional GIN index
   * from migration 0005 — the `to_tsvector('english', content)` expression here
   * MUST match that index's expression exactly or Postgres won't use it.
   */
  async searchFullText(orgId: string, query: string, limit: number = 15, documentIds?: string[]) {
    const tsquery = sql`websearch_to_tsquery('english', ${query})`;
    const tsvector = sql`to_tsvector('english', ${documentChunks.content})`;
    const rank = sql<number>`ts_rank_cd(${tsvector}, ${tsquery})`;

    const conditions = [
      eq(documentChunks.orgId, orgId),
      eq(documentChunks.isActive, true),
      eq(documents.isDeleted, false),
      sql`${tsvector} @@ ${tsquery}`,
    ];

    if (documentIds && documentIds.length > 0) {
      conditions.push(inArray(documentChunks.documentId, documentIds));
    }

    const results = await this.db
      .select({
        chunk: documentChunks,
        document: documents,
        rank,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(and(...conditions))
      .orderBy(desc(rank))
      .limit(limit);

    return results;
  }
}
