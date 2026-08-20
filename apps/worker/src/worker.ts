import { Worker, Job } from 'bullmq';
import { INGESTION_QUEUE_NAME, redisConnection } from './queue.js';
import { JobRepository, ChunkRepository } from '@rag/database';
import { PdfParser, DocxParser, TxtParser, RecursiveChunker, GeminiEmbeddingProvider } from '@rag/providers';
import fs from 'fs';
import path from 'path';

const jobRepo = new JobRepository();
const chunkRepo = new ChunkRepository();

export interface IngestionJobData {
  jobId: string;
  documentId: string;
  versionId: string; // The version ID is currently null in Phase 4, we will use documentId for versionId temporarily until versioning is fully built.
  orgId: string;
  filePath: string;
  fileType: string;
}

export const ingestionWorker = new Worker<IngestionJobData>(
  INGESTION_QUEUE_NAME,
  async (job: Job<IngestionJobData>) => {
    const { jobId, documentId, orgId, fileType } = job.data;
    
    // Fallback: wait for filepath or use tmp path since Phase 4 writes to tmp/uploads
    let filePath = job.data.filePath;
    if (!filePath) {
       filePath = path.join(process.cwd(), 'tmp', 'uploads', orgId);
       const files = await fs.promises.readdir(filePath);
       // Temporary logic to pick up the file, assuming it's the only one for testing
       const match = files.find(f => f.endsWith(`.${fileType}`));
       if (match) {
         filePath = path.join(filePath, match);
       }
    }

    console.log(`[Worker] Starting job ${jobId} for document ${documentId}`);

    try {
      // 1. Parsing Phase
      await jobRepo.updateStatus(orgId, jobId, 'parsing', 'parsing_document', { chunks_total: 0 });
      console.log(`[Worker] Parsing ${filePath}...`);
      
      const buffer = await fs.promises.readFile(filePath);
      let parser;
      if (fileType === 'pdf') parser = new PdfParser();
      else if (fileType === 'docx') parser = new DocxParser();
      else parser = new TxtParser();

      const parsed = await parser.parse(buffer, fileType);
      
      // 2. Chunking Phase
      await jobRepo.updateStatus(orgId, jobId, 'chunking', 'creating_chunks', { chunks_total: 0 });
      console.log(`[Worker] Chunking document...`);
      
      const chunker = new RecursiveChunker(1500, 200);
      const chunks = await chunker.chunk(parsed.text);
      const chunks_total = chunks.length;
      
      // 3. Embedding Phase
      await jobRepo.updateStatus(orgId, jobId, 'embedding', 'generating_embeddings', { chunks_total, chunks_embedded: 0 });
      console.log(`[Worker] Embedding ${chunks_total} chunks...`);
      
      const embedder = new GeminiEmbeddingProvider();
      
      // Generate embeddings in batches of 100
      const batchSize = 100;
      const chunksWithEmbeddings: { text: string; embedding: number[]; metadata?: any }[] = [];
      
      for (let i = 0; i < chunks_total; i += batchSize) {
         const batch = chunks.slice(i, i + batchSize);
         const texts = batch.map(c => c.text);
         
         const result = await embedder.embed(texts);
         
         for (let j = 0; j < batch.length; j++) {
           const embedding = result.embeddings[j];
           const chunk = batch[j];
           if (embedding && chunk) {
             chunksWithEmbeddings.push({
               text: chunk.text,
               embedding,
               metadata: chunk.metadata,
             });
           }
         }
         await jobRepo.updateStatus(orgId, jobId, 'embedding', 'generating_embeddings', { chunks_total, chunks_embedded: chunksWithEmbeddings.length });
      }
      
      // 4. Indexing Phase (Save to pgvector via ChunkRepository)
      await jobRepo.updateStatus(orgId, jobId, 'indexing', 'saving_to_pgvector', { chunks_total, chunks_indexed: 0 });
      console.log(`[Worker] Saving to Postgres (pgvector)...`);
      
      const versionId = job.data.versionId || documentId; // Temporary hack until documentVersions are created
      
      await chunkRepo.insertChunks(orgId, documentId, versionId, chunksWithEmbeddings);

      // 5. Completion
      await jobRepo.updateStatus(orgId, jobId, 'completed', 'done', { chunks_total, chunks_indexed: chunks_total });
      console.log(`[Worker] Job ${jobId} completed successfully.`);
      
    } catch (error) {
      console.error(`[Worker] Job ${jobId} failed:`, error);
      if (error instanceof Error) {
        await jobRepo.failJob(orgId, jobId, error);
      }
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  }
);

ingestionWorker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed!`);
});

ingestionWorker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});
