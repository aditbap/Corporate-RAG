export interface ScoredChunk {
  id: string;
  content: string;
  documentId: string;
  score?: number;
  fusionScore?: number;
  [key: string]: unknown;
}

export interface RerankerProvider {
  readonly name: string;
  readonly model: string;

  rerank(query: string, candidates: ScoredChunk[], topN: number): Promise<ScoredChunk[]>;
}
