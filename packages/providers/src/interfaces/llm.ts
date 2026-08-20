export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: LLMUsage;
  latency_ms: number;
}

export interface LLMStreamChunk {
  content: string; // The delta content
  isFinal: boolean;
  model?: string;
  usage?: LLMUsage;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Generates a complete response
   */
  generate(messages: LLMMessage[]): Promise<LLMResponse>;

  /**
   * Generates a response incrementally as a stream of chunks
   */
  generateStream(messages: LLMMessage[]): AsyncIterable<LLMStreamChunk>;
}
