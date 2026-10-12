import type { ParsedDocument } from '@rag/core';

/**
 * Client for the local PaddleOCR sidecar (infra/ocr) — a separate Python/FastAPI
 * process, not an in-process library, since PaddleOCR has no usable Node.js
 * binding. Used for scanned PDFs (text layer too sparse to trust) and for image
 * uploads (jpeg/png/webp), which have no text layer at all.
 */
export class PaddleOcrProvider {
  public readonly name = 'paddleocr';
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    const url = baseUrl || process.env.OCR_SERVICE_URL;
    if (!url) {
      throw new Error('OCR_SERVICE_URL is required');
    }
    this.baseUrl = url.replace(/\/$/, '');
  }

  async run(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);

    const res = await fetch(`${this.baseUrl}/ocr`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`OCR service returned ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const result = (await res.json()) as { text: string; pages: Array<{ number: number; text: string }> };
    return { text: result.text, pages: result.pages, metadata: { source: 'ocr' } };
  }
}

/**
 * Heuristic from the ingestion decision tree: if a PDF's extracted text layer
 * averages under ~100 chars/page, treat it as a scanned/image-only PDF and
 * route it through OCR instead of trusting the (near-empty) extracted text.
 */
export function needsOcr(parsed: ParsedDocument): boolean {
  if (parsed.pages.length === 0) return parsed.text.trim().length === 0;
  const avgCharsPerPage = parsed.text.length / parsed.pages.length;
  return avgCharsPerPage < 100;
}
