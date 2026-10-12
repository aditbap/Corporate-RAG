import { LLMProvider, LLMMessage, LLMResponse, LLMStreamChunk } from '../interfaces/llm.js';

export class CloudflareLLMProvider implements LLMProvider {
  public readonly name = 'cloudflare';
  public readonly model: string;
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor(accountId?: string, apiToken?: string, modelName?: string) {
    this.accountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = apiToken || process.env.CLOUDFLARE_API_TOKEN || '';
    this.model = modelName || process.env.LLM_PRIMARY_MODEL || '@cf/meta/llama-3.1-8b-instruct';

    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) are required');
    }
  }

  private get url() {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`;
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    const start = Date.now();

    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Cloudflare API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as { result?: { response?: string } };
    const result = data.result ?? {};

    const latency_ms = Date.now() - start;

    return {
      content: result.response || '',
      model: this.model,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      latency_ms,
    };
  }

  async *generateStream(messages: LLMMessage[]): AsyncIterable<LLMStreamChunk> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        })),
        stream: true
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Cloudflare API error: ${response.status} ${err}`);
    }

    if (!response.body) {
      throw new Error('No response body from Cloudflare API');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    if ('getReader' in response.body) {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;
          if (line.startsWith('data: ')) {
            try {
              const dataStr = line.slice(6);
              const data = JSON.parse(dataStr);
              yield {
                content: data.response || '',
                isFinal: false,
                model: this.model
              };
            } catch { /* ignore non-JSON SSE lines */ }
          }
        }
      }
    } else {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;
          if (line.startsWith('data: ')) {
            try {
              const dataStr = line.slice(6);
              const data = JSON.parse(dataStr);
              yield {
                content: data.response || '',
                isFinal: false,
                model: this.model
              };
            } catch { /* ignore non-JSON SSE lines */ }
          }
        }
      }
    }

    yield {
      content: '',
      isFinal: true,
      model: this.model
    };
  }
}
