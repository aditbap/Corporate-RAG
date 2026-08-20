export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChunk {
  type: 'content' | 'sources' | 'usage' | 'done' | 'error';
  delta?: string;
  sources?: any[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  message_id?: string;
  error?: string;
}

export interface GenerateParams {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface GenerateResult {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finish_reason: string;
  latency_ms: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;

  generate(params: GenerateParams): Promise<GenerateResult>;
  generateStream(params: GenerateParams): AsyncIterable<StreamChunk>;
}
