import { CohereClient } from 'cohere-ai';
import type { RerankerProvider, ScoredChunk } from '@rag/core';

export class CohereRerankerProvider implements RerankerProvider {
  public readonly name = 'cohere';
  public readonly model: string;
  private cohere: CohereClient;

  constructor(apiKey?: string, modelName?: string) {
    const token = apiKey || process.env.COHERE_API_KEY;
    if (!token) {
      throw new Error('COHERE_API_KEY is required');
    }
    this.cohere = new CohereClient({ token });
    this.model = modelName || process.env.RERANKER_MODEL || 'rerank-english-v3.0';
  }

  async rerank(query: string, candidates: ScoredChunk[], topN: number = 5): Promise<ScoredChunk[]> {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    try {
      const response = await this.cohere.rerank({
        model: this.model,
        query,
        documents: candidates.map((c) => c.content),
        topN,
      });

      return response.results.flatMap((result) => {
        const candidate = candidates[result.index];
        return candidate ? [{ ...candidate, score: result.relevanceScore }] : [];
      });
    } catch (error) {
      console.error('Error reranking documents with Cohere:', error);
      throw error;
    }
  }
}
