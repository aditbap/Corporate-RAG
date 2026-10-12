import { ChunkerProvider, ChunkResult } from '@rag/core';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export class RecursiveChunker implements ChunkerProvider {
  public readonly name = 'recursive-character';
  
  private splitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize: number = 1500, chunkOverlap: number = 200) {
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
  }

  async chunk(text: string, metadata?: Record<string, unknown>): Promise<ChunkResult[]> {
    const docs = await this.splitter.createDocuments([text], [metadata || {}]);
    
    return docs.map(doc => ({
      text: doc.pageContent,
      metadata: doc.metadata
    }));
  }
}
