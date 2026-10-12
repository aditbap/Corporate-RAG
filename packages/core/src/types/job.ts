export type JobStatus = 
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface IngestionJob {
  id: string;
  documentId: string;
  versionId: string;
  orgId: string;
  status: JobStatus;
  currentStage: string | null;
  progress: JobProgress;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  errorDetails: unknown;
  idempotencyKey: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobProgress {
  chunks_total?: number;
  chunks_embedded?: number;
  chunks_indexed?: number;
  [key: string]: unknown;
}
