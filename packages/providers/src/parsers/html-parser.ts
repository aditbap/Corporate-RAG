import { DocumentParser, ParsedDocument } from '@rag/core';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', ndash: '–', mdash: '—',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1]?.toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

/**
 * Reduces an HTML document to its readable text. Scripts, styles and comments are dropped
 * (never indexed), block-level tags become line breaks so chunking keeps paragraph boundaries.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|tr|table|section|article|header|footer|h[1-6]|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class HtmlParser implements DocumentParser {
  public readonly name = 'html-parser';
  public readonly supportedTypes = ['html', 'text/html'];

  async parse(buffer: Buffer, fileType: string): Promise<ParsedDocument> {
    if (!this.supportedTypes.includes(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    const text = htmlToText(buffer.toString('utf-8'));
    return { text, pages: [{ number: 1, text }], metadata: {} };
  }
}
