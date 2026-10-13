import { db, sql } from '@rag/database';
import type { StorageProvider } from '@rag/core';

export interface PurgeResult {
  librariesPurged: number;
  documentsPurged: number;
  objectsDeleted: number;
}

/**
 * Permanently removes data that was only soft-deleted:
 *  - shared libraries archived (deleted) more than `retentionDays` ago: their objects and every row;
 *  - documents deleted more than `retentionDays` ago: their stored files and rows.
 *
 * The grace period is the window in which an accidental deletion can still be recovered by an
 * operator. Objects are removed BEFORE the rows that point at them, so a storage failure leaves
 * the rows in place and the next run retries; the whole thing is idempotent.
 */
export async function purgeExpired(
  storage: Pick<StorageProvider, 'delete' | 'deleteByPrefix'>,
  retentionDays: number,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const result: PurgeResult = { librariesPurged: 0, documentsPurged: 0, objectsDeleted: 0 };

  const libraries = await db.execute<{ id: string }>(
    sql`select id from organizations where kind = 'shared' and is_active = false and updated_at < ${cutoff}::timestamptz`,
  );
  for (const { id } of libraries) {
    result.objectsDeleted += await storage.deleteByPrefix(`${id}/`);
    await db.execute(sql`delete from organizations where id = ${id}`);
    result.librariesPurged++;
  }

  // Bounded batch per run so a large backlog can't hold the connection for long.
  const documents = await db.execute<{ id: string; paths: string[] | null }>(sql`
    select d.id, array_remove(array_agg(v.file_path), null) as paths
    from documents d
    join organizations o on o.id = d.org_id and o.is_active = true
    left join document_versions v on v.document_id = d.id
    where d.is_deleted = true and d.deleted_at < ${cutoff}::timestamptz
    group by d.id
    limit 500`);
  for (const doc of documents) {
    for (const path of doc.paths ?? []) {
      await storage.delete(path);
      result.objectsDeleted++;
    }
    await db.execute(sql`delete from documents where id = ${doc.id}`);
    result.documentsPurged++;
  }

  return result;
}
