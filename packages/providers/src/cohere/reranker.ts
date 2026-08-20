import { CohereClient } from 'cohere-ai';

export interface RerankedDocument {
  index: number;
  relevanceScore: number;
}

export class CohereRerankerProvider {
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

  async rerank(query: string, documents: string[], topN: number = 5): Promise<RerankedDocument[]> {
    if (!documents || documents.length === 0) {
      return [];
    }
    
    try {
      const response = await this.cohere.rerank({
        model: this.model,
        query,
        documents,
        topN,
      });

      return response.results.map((result) => ({
        index: result.index,
        relevanceScore: result.relevanceScore,
      }));
    } catch (error) {
      console.error('Error reranking documents with Cohere:', error);
      throw error;
    }
  }
}
