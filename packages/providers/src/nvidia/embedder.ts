import { EmbeddingProvider, EmbeddingResult } from '@rag/core';

export class NvidiaEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'nvidia';
  public readonly model: string;
  public readonly dimensions: number;
  private readonly apiKey: string;
  private inputType: string;
  private readonly timeoutMs: number;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.NVIDIA_API_KEY || '';
    let modelStr = modelName || process.env.EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';
    if (!modelStr.includes('/')) {
        modelStr = `nvidia/${modelStr}`;
    }
    this.model = modelStr;
    this.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10);
    this.inputType = 'passage';
    this.timeoutMs = parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10);
    
    if (!this.apiKey) {
      throw new Error('NVIDIA_API_KEY is required');
    }
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const start = Date.now();
    
    const payload = {
        input: texts,
        model: this.model,
        input_type: this.inputType,
        encoding_format: 'float',
        truncate: 'END'
    };
    // Log shape only - the payload contains full document text.
    console.debug(`[NVIDIA] embedding ${texts.length} text(s) as '${this.inputType}' with ${this.model}`);
    
    // Guard against an upstream that accepts the connection but never responds:
    // without this the caller (chat request / ingestion job) hangs forever.
    let response: Response;
    try {
      response = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(
          `NVIDIA embeddings request timed out after ${this.timeoutMs}ms (model: ${this.model})`
        );
      }
      throw err;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`NVIDIA API error: ${response.status} ${err}`);
    }

    const data = await response.json() as any;
    
    const embeddings = data.data.map((item: any) => {
      let vec = item.embedding as number[];
      return vec;
    });

    const latency_ms = Date.now() - start;
    
    return {
      embeddings,
      model: this.model,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0
      },
      latency_ms,
    };
  }

  async embedQuery(text: string): Promise<number[]> {
    this.inputType = 'query';
    try {
      const result = await this.embed([text]);
      if (!result.embeddings[0]) {
        throw new Error('Failed to generate embedding for query');
      }
      return result.embeddings[0];
    } finally {
      this.inputType = 'passage';
    }
  }
}
