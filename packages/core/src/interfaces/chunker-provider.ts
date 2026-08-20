export interface ChunkResult {
  text: string;
  pageNumber?: number;
  sectionHeading?: string;
  metadata?: Record<string, any>;
}

export interface ChunkerProvider {
  readonly name: string;
  
  chunk(text: string, metadata?: Record<string, any>): Promise<ChunkResult[]>;
}
