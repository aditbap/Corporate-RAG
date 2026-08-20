import { GoogleGenAI } from '@google/genai';
import { LLMProvider, LLMMessage, LLMResponse, LLMStreamChunk } from '../interfaces/llm.js';

export class GeminiLLMProvider implements LLMProvider {
  public readonly name = 'gemini';
  public readonly model: string;

  private ai: GoogleGenAI;

  constructor(apiKey?: string, modelName?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
    this.model = modelName || process.env.LLM_PRIMARY_MODEL || 'gemini-2.5-flash';
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    const start = Date.now();

    // Convert to Gemini format
    let systemInstruction = undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      }
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
      }
    });

    const latency_ms = Date.now() - start;

    const usageMetadata = response.usageMetadata;
    const usage = {
      prompt_tokens: usageMetadata?.promptTokenCount || 0,
      completion_tokens: usageMetadata?.candidatesTokenCount || 0,
      total_tokens: usageMetadata?.totalTokenCount || 0,
    };

    return {
      content: response.text || '',
      model: this.model,
      usage,
      latency_ms,
    };
  }

  async *generateStream(messages: LLMMessage[]): AsyncIterable<LLMStreamChunk> {
    let systemInstruction = undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      }
    }

    const responseStream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction,
      }
    });

    for await (const chunk of responseStream) {
      const usageMetadata = chunk.usageMetadata;
      const usage = usageMetadata ? {
        prompt_tokens: usageMetadata.promptTokenCount || 0,
        completion_tokens: usageMetadata.candidatesTokenCount || 0,
        total_tokens: usageMetadata.totalTokenCount || 0,
      } : undefined;

      yield {
        content: chunk.text || '',
        isFinal: !!usageMetadata, // Gemini sends usage in the final chunk
        model: this.model,
        usage,
      };
    }
  }
}
