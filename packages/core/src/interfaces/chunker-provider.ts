export interface ChunkResult {
  text: string;
  pageNumber?: number;
  sectionHeading?: string;
  metadata?: Record<string, unknown>;
}

export interface ChunkerProvider {
  readonly name: string;
  
  chunk(text: string, metadata?: Record<string, unknown>): Promise<ChunkResult[]>;
}
