import { DocumentParser, ParsedDocument } from '@rag/core';
import mammoth from 'mammoth';

export class DocxParser implements DocumentParser {
  public readonly name = 'docx-parser';
  public readonly supportedTypes = ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

  async parse(buffer: Buffer, fileType: string): Promise<ParsedDocument> {
    if (!this.supportedTypes.includes(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    const result = await mammoth.extractRawText({ buffer });
    
    return {
      text: result.value,
      pages: [{ number: 1, text: result.value }],
      metadata: {
        messages: result.messages
      }
    };
  }
}
