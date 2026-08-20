export interface Conversation {
  id: string;
  orgId: string;
  userId: string;
  title: string | null;
  isArchived: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  orgId: string;
  role: MessageRole;
  content: string;
  tokenCount: number | null;
  model: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface Citation {
  id: string;
  messageId: string;
  chunkId: string;
  documentId: string;
  orgId: string;
  citationIndex: number;
  relevanceScore: number | null;
  snippet: string | null;
  pageNumber: number | null;
  sectionHeading: string | null;
  createdAt: Date;
}

export interface CitationRef {
  citation_index: number;
  document_id: string;
  document_title: string;
  page_number: number | null;
  section: string | null;
  chunk_id: string;
  relevance_score: number;
  snippet: string;
}
