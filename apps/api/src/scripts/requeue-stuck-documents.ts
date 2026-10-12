/**
 * Requeue documents whose ingestion never completed.
 *
 * Background: BullMQ jobs live in Redis while the `documents` / `ingestion_jobs`
 * rows live in Postgres. If the Redis queue is flushed or evicted while jobs are
 * still in flight, the Postgres rows are orphaned: the documents sit at
 * `processing` forever, no chunks are ever produced, and nothing retries them.
 *
 * This script finds documents that have no chunks, recovers the uploaded file
 * from disk, and re-enqueues a fresh ingestion job for each one.
 *
 * The uploaded file is located in two ways, in order of reliability:
 *   1. `document_versions.file_path` — the exact path recorded at upload time.
 *   2. SHA-256 of the files under `tmp/uploads/<orgId>` matched against
 *      `documents.file_hash` — used when the version row is missing or the
 *      recorded path no longer exists.
 *
 * Usage:
 *   pnpm --filter @rag/api requeue:stuck              # dry run, reports only
 *   pnpm --filter @rag/api requeue:stuck --apply      # actually enqueue
 */
import '../setup.js'; // must precede any import that reads env at module load
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db, documents, documentVersions, ingestionJobs, documentChunks, eq, sql as dsql } from '@rag/database';
import { ingestionQueue, redisConnection } from '../queue.js';

const APPLY = process.argv.includes('--apply');

type Candidate = {
  documentId: string;
  orgId: string;
  fileType: string;
  fileName: string;
  fileHash: string;
  status: string;
  recordedPath: string | null;
};

function uploadDirFor(orgId: string) {
  return path.join(process.cwd(), 'tmp', 'uploads', orgId);
}

/** SHA-256 -> absolute path, for every file currently under the org's upload dir. */
function buildHashIndex(orgIds: string[]) {
  const index = new Map<string, string>();
  for (const orgId of orgIds) {
    const dir = uploadDirFor(orgId);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const filePath = path.join(dir, entry);
      if (!fs.statSync(filePath).isFile()) continue;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      if (!index.has(hash)) index.set(hash, filePath);
    }
  }
  return index;
}

function resolveFile(c: Candidate, hashIndex: Map<string, string>) {
  if (c.recordedPath && fs.existsSync(c.recordedPath)) {
    return { filePath: c.recordedPath, via: 'recorded path' as const };
  }
  const match = hashIndex.get(c.fileHash);
  if (match) return { filePath: match, via: 'content hash' as const };
  return null;
}

async function main() {
  // Documents that produced no chunks are the ones that never finished ingesting.
  const rows = await db
    .select({
      documentId: documents.id,
      orgId: documents.orgId,
      fileType: documents.fileType,
      fileName: documents.fileName,
      fileHash: documents.fileHash,
      status: documents.status,
      recordedPath: documentVersions.filePath,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.id, documents.id))
    .where(
      dsql`not exists (select 1 from ${documentChunks} where ${documentChunks.documentId} = ${documents.id})
           and ${documents.isDeleted} = false`
    );

  const candidates = rows as Candidate[];
  if (candidates.length === 0) {
    console.log('Nothing to do: every document already has chunks.');
    return;
  }

  const hashIndex = buildHashIndex([...new Set(candidates.map((c) => c.orgId))]);
  console.log(`Found ${candidates.length} document(s) without chunks.`);
  console.log(`Indexed ${hashIndex.size} unique file(s) on disk.\n`);

  const requeued: string[] = [];
  const unrecoverable: Candidate[] = [];

  for (const c of candidates) {
    const resolved = resolveFile(c, hashIndex);
    if (!resolved) {
      unrecoverable.push(c);
      console.log(`  SKIP  ${c.fileName} (${c.documentId}) - uploaded file not found on disk`);
      continue;
    }

    console.log(`  QUEUE ${c.fileName} (${c.documentId}) - via ${resolved.via}`);
    if (!APPLY) {
      requeued.push(c.documentId);
      continue;
    }

    // The worker writes chunks against a version id, and chunk rows carry an FK
    // to document_versions, so the version row has to exist before we enqueue.
    // Upload uses documentId as the versionId, so we keep that convention.
    const versionId = c.documentId;
    await db
      .insert(documentVersions)
      .values({
        id: versionId,
        documentId: c.documentId,
        orgId: c.orgId,
        versionNumber: 1,
        filePath: resolved.filePath,
        fileHash: c.fileHash,
        fileSizeBytes: fs.statSync(resolved.filePath).size,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: documentVersions.id,
        set: { filePath: resolved.filePath },
      });

    // Replace any orphaned job rows for this document with a single fresh one,
    // so progress reporting reflects this run rather than the abandoned attempt.
    await db.delete(ingestionJobs).where(eq(ingestionJobs.documentId, c.documentId));
    const jobId = crypto.randomUUID();
    await db.insert(ingestionJobs).values({
      id: jobId,
      documentId: c.documentId,
      versionId,
      orgId: c.orgId,
      status: 'pending',
      idempotencyKey: crypto.randomUUID(),
    });

    await db
      .update(documents)
      .set({ status: 'processing', errorMessage: null })
      .where(eq(documents.id, c.documentId));

    await ingestionQueue.add(
      'ingest-document',
      {
        jobId,
        documentId: c.documentId,
        versionId,
        orgId: c.orgId,
        filePath: resolved.filePath,
        fileType: c.fileType,
      },
      { jobId: crypto.randomUUID() }
    );

    requeued.push(c.documentId);
  }

  // Documents whose source file is gone can never be ingested. Leave them in a
  // terminal state so the UI stops showing them as perpetually in-progress.
  if (APPLY) {
    for (const c of unrecoverable) {
      await db
        .update(documents)
        .set({
          status: 'failed',
          errorMessage: 'Original uploaded file is no longer available on disk. Please re-upload.',
        })
        .where(eq(documents.id, c.documentId));
    }
  }

  console.log(
    `\n${APPLY ? 'Requeued' : 'Would requeue'} ${requeued.length} document(s); ` +
      `${unrecoverable.length} unrecoverable.`
  );
  if (!APPLY) console.log('Dry run - re-run with --apply to make these changes.');
}

main()
  .catch((err) => {
    console.error('Requeue failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ingestionQueue.close();
    redisConnection.disconnect();
    process.exit(process.exitCode ?? 0);
  });
