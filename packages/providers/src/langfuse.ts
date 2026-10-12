import { Langfuse } from 'langfuse';

let langfuseClient: Langfuse | null = null;

export function getLangfuse(): Langfuse {
  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY || 'dummy_sk',
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || 'dummy_pk',
      baseUrl: process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'
    });
  }
  return langfuseClient;
}

// Ensure telemetry doesn't drop during server shutdown
export async function flushLangfuse() {
  if (langfuseClient) {
    try {
      await langfuseClient.flushAsync();
    } catch (err) {
      console.error('Failed to flush Langfuse telemetry:', err);
    }
  }
}
