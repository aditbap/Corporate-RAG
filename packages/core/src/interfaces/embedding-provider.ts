export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
  latency_ms: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;

  embed(texts: string[]): Promise<EmbeddingResult>;
  embedQuery(text: string): Promise<number[]>;
}
