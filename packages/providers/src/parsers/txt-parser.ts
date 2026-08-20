import { DocumentParser, ParsedDocument } from '@rag/core';

export class TxtParser implements DocumentParser {
  public readonly name = 'txt-parser';
  public readonly supportedTypes = ['txt', 'text/plain', 'md', 'text/markdown'];

  async parse(buffer: Buffer, fileType: string): Promise<ParsedDocument> {
    if (!this.supportedTypes.includes(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    const text = buffer.toString('utf-8');
    
    return {
      text,
      pages: [{ number: 1, text }],
      metadata: {}
    };
  }
}
