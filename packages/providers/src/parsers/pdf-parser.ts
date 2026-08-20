import { DocumentParser, ParsedDocument } from '@rag/core';
import { PDFParse } from 'pdf-parse';

export class PdfParser implements DocumentParser {
  public readonly name = 'pdf-parser';
  public readonly supportedTypes = ['pdf', 'application/pdf'];

  async parse(buffer: Buffer, fileType: string): Promise<ParsedDocument> {
    if (!this.supportedTypes.includes(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    
    return {
      text: textResult.text,
      pages: textResult.pages.map(p => ({ number: p.num, text: p.text })),
      metadata: {
        numpages: infoResult.total,
        info: infoResult.info,
      }
    };
  }
}
