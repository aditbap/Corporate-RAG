export type DocumentStatus = 'uploaded' | 'processing' | 'ready' | 'failed' | 'deleted';

export interface Document {
  id: string;
  orgId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  fileHash: string;
  status: DocumentStatus;
  activeVersionId: string | null;
  tags: string[];
  metadata: Record<string, string>;
  uploadedBy: string | null;
  errorMessage: string | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  orgId: string;
  versionNumber: number;
  filePath: string;
  fileHash: string;
  fileSizeBytes: number;
  chunkCount: number;
  isActive: boolean;
  isIndexed: boolean;
  parsedContent: any | null;
  createdAt: Date;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  versionId: string;
  orgId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionHeading: string | null;
  parentChunkId: string | null;
  metadata: ChunkMetadata;
  embeddingModel: string | null;
  qdrantPointId: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface ChunkMetadata {
  page_number?: number | null;
  section_heading?: string | null;
  heading_hierarchy?: string[];
  is_table?: boolean;
  is_code?: boolean;
  [key: string]: any;
}
