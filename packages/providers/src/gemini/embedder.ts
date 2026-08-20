import { GoogleGenAI } from '@google/genai';
import { EmbeddingProvider, EmbeddingResult } from '@rag/core';

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'gemini';
  public readonly model = process.env.EMBEDDING_MODEL || 'gemini-embedding-2';
  public readonly dimensions = 768;
  
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const start = Date.now();
    
    const response = await this.ai.models.embedContent({
      model: this.model,
      contents: texts,
      config: {
        outputDimensionality: this.dimensions,
      }
    });

    const latency_ms = Date.now() - start;
    
    // Check if response has multiple embeddings
    const embeddings: number[][] = (response.embeddings || []).map(e => e.values || []);
    
    // Mock token counts as the SDK doesn't always return this explicitly for embeddings
    const prompt_tokens = texts.join(' ').length / 4; // Rough estimate
    
    return {
      embeddings,
      model: this.model,
      usage: { prompt_tokens: Math.round(prompt_tokens), total_tokens: Math.round(prompt_tokens) },
      latency_ms,
    };
  }

  async embedQuery(text: string): Promise<number[]> {
    const result = await this.embed([text]);
    if (!result.embeddings[0]) {
      throw new Error('Failed to generate embedding for query');
    }
    return result.embeddings[0];
  }
}
