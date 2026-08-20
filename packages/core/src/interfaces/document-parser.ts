export interface ParsedDocument {
  text: string;
  pages: Array<{ number: number; text: string }>;
  metadata: Record<string, any>;
}

export interface DocumentParser {
  readonly name: string;
  readonly supportedTypes: string[];

  parse(buffer: Buffer, fileType: string): Promise<ParsedDocument>;
}
