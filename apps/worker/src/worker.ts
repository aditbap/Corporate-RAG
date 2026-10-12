import { Worker, Job } from 'bullmq'; // force reload
import { INGESTION_QUEUE_NAME, redisConnection } from './queue.js';
import { JobRepository, ChunkRepository, DocumentRepository } from '@rag/database';
import {
  PdfParser, DocxParser, TxtParser, RecursiveChunker, NvidiaEmbeddingProvider, MinioStorageProvider,
  PaddleOcrProvider, needsOcr, scanBuffer,
} from '@rag/providers';
import type { ParsedDocument } from '@rag/core';

const IMAGE_TYPES = ['jpeg', 'png', 'webp'];
const ENABLE_VIRUS_SCAN = process.env.ENABLE_VIRUS_SCAN === 'true';

const jobRepo = new JobRepository();
const chunkRepo = new ChunkRepository();
const docRepo = new DocumentRepository();
const storage = MinioStorageProvider.fromEnv();

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export interface IngestionJobData {
  jobId: string;
  documentId: string;
  versionId: string;
  orgId: string;
  filePath: string;
  fileType: string;
}

export const ingestionWorker = new Worker<IngestionJobData>(
  INGESTION_QUEUE_NAME,
  async (job: Job<IngestionJobData>) => {
    const { jobId, documentId, orgId, fileType, filePath: objectKey } = job.data;

    console.log(`[Worker] Starting job ${jobId} for document ${documentId}`);

    try {
      await docRepo.updateStatus(orgId, documentId, 'processing');
      const buffer = await streamToBuffer(await storage.download(objectKey));

      // 0. Virus scan (optional — ClamAV sidecar takes a while to warm up on
      // first boot, so this stays opt-in via ENABLE_VIRUS_SCAN rather than
      // being a hard dependency of every ingestion run).
      if (ENABLE_VIRUS_SCAN) {
        await jobRepo.updateStatus(orgId, jobId, 'parsing', 'scanning_for_viruses', {});
        const scanResult = await scanBuffer(buffer);
        if (scanResult.infected) {
          throw new Error(`File rejected: virus scan matched signature "${scanResult.signature}"`);
        }
      }

      // 1. Parsing Phase
      await jobRepo.updateStatus(orgId, jobId, 'parsing', 'parsing_document', { chunks_total: 0 });
      console.log(`[Worker] Parsing ${objectKey}...`);

      let parsed: ParsedDocument;
      if (IMAGE_TYPES.includes(fileType)) {
        // Images have no text layer at all — straight to OCR.
        await jobRepo.updateStatus(orgId, jobId, 'parsing', 'ocr_processing', {});
        parsed = await new PaddleOcrProvider().run(buffer, `document.${fileType}`);
      } else {
        let parser;
        if (fileType === 'pdf') parser = new PdfParser();
        else if (fileType === 'docx') parser = new DocxParser();
        else parser = new TxtParser();

        parsed = await parser.parse(buffer, fileType);

        if (fileType === 'pdf' && needsOcr(parsed)) {
          console.log(`[Worker] PDF text layer too sparse, routing to OCR...`);
          await jobRepo.updateStatus(orgId, jobId, 'parsing', 'ocr_processing', {});
          parsed = await new PaddleOcrProvider().run(buffer, 'document.pdf');
        }
      }

      // 2. Chunking Phase
      await jobRepo.updateStatus(orgId, jobId, 'chunking', 'creating_chunks', { chunks_total: 0 });
      console.log(`[Worker] Chunking document...`);
      
      const chunker = new RecursiveChunker(1500, 200);
      const chunks = await chunker.chunk(parsed.text);
      const chunks_total = chunks.length;

      if (chunks_total === 0) {
        throw new Error('No text could be extracted from this document (it may be a scanned/image-only file or empty)');
      }

      // 3. Embedding Phase
      await jobRepo.updateStatus(orgId, jobId, 'embedding', 'generating_embeddings', { chunks_total, chunks_embedded: 0 });
      console.log(`[Worker] Embedding ${chunks_total} chunks...`);
      
      const embedder = new NvidiaEmbeddingProvider();
      
      // Generate embeddings in batches of 100
      const batchSize = 100;
      const chunksWithEmbeddings: { text: string; embedding: number[]; metadata?: Record<string, unknown> }[] = [];
      
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
      
      const versionId = job.data.versionId;

      await chunkRepo.insertChunks(orgId, documentId, versionId, chunksWithEmbeddings, embedder.model);

      // A re-uploaded document version has its own chunks inserted above; make
      // sure the previous version's chunks stop showing up in search.
      await chunkRepo.deactivateOtherVersions(orgId, documentId, versionId);

      // 5. Completion
      await jobRepo.updateStatus(orgId, jobId, 'completed', 'done', { chunks_total, chunks_indexed: chunks_total });
      await docRepo.updateStatus(orgId, documentId, 'ready');
      // New knowledge is searchable now — invalidate this org's cached chat answers.
      await redisConnection.incr(`rag:cache-version:${orgId}`).catch(() => undefined);
      console.log(`[Worker] Job ${jobId} completed successfully.`);

    } catch (error) {
      console.error(`[Worker] Job ${jobId} failed:`, error);
      if (error instanceof Error) {
        await jobRepo.failJob(orgId, jobId, error);
        await docRepo.updateStatus(orgId, documentId, 'failed', error.message);
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
