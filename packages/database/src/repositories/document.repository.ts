import { eq, and, isNull, desc, getTableColumns } from 'drizzle-orm';
import { BaseRepository } from './base.repository';
import { documents, documentVersions, users } from '../schema/index';

export class DocumentRepository extends BaseRepository {
  constructor() {
    super('documents');
  }

  async findById(tenantId: string, id: string) {
    this.requireTenant(tenantId);
    return this.db.query.documents.findFirst({
      where: and(
        eq(documents.id, id),
        eq(documents.orgId, tenantId),
        eq(documents.isDeleted, false)
      )
    });
  }

  async listVersions(tenantId: string, documentId: string) {
    this.requireTenant(tenantId);
    return this.db.query.documentVersions.findMany({
      where: and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.orgId, tenantId)
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
    });
  }

  async getActiveVersion(tenantId: string, documentId: string) {
    this.requireTenant(tenantId);
    return this.db.query.documentVersions.findFirst({
      where: and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.orgId, tenantId),
        eq(documentVersions.isActive, true)
      )
    });
  }

  async list(tenantId: string, limit = 20, offset = 0, folderId?: string | null) {
    this.requireTenant(tenantId);
    
    const conditions = [
      eq(documents.orgId, tenantId),
      eq(documents.isDeleted, false)
    ];

    if (folderId === null) {
      conditions.push(isNull(documents.folderId));
    } else if (folderId !== undefined) {
      conditions.push(eq(documents.folderId, folderId));
    }

    return this.db.query.documents.findMany({
      where: and(...conditions),
      limit,
      offset,
      orderBy: (docs, { desc }) => [desc(docs.createdAt)],
    });
  }
  
  /** Like list(), but each row carries the uploader's display name (for shared libraries). */
  async listWithUploader(tenantId: string, limit = 20, offset = 0, folderId?: string | null) {
    this.requireTenant(tenantId);

    const conditions = [eq(documents.orgId, tenantId), eq(documents.isDeleted, false)];
    if (folderId === null) conditions.push(isNull(documents.folderId));
    else if (folderId !== undefined) conditions.push(eq(documents.folderId, folderId));

    return this.db
      .select({ ...getTableColumns(documents), uploaderName: users.fullName, uploaderEmail: users.email })
      .from(documents)
      .leftJoin(users, eq(users.id, documents.uploadedBy))
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async create(tenantId: string, data: typeof documents.$inferInsert) {
    this.requireTenant(tenantId);
    const [result] = await this.db.insert(documents).values({
      ...data,
      orgId: tenantId,
    }).returning();
    return result;
  }

  async softDelete(tenantId: string, id: string) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(documents)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.orgId, tenantId)))
      .returning();
    return result;
  }

  async move(tenantId: string, id: string, folderId: string | null) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(documents)
      .set({ folderId, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.orgId, tenantId)))
      .returning();
    return result;
  }

  async updateStatus(tenantId: string, id: string, status: typeof documents.$inferSelect['status'], errorMessage?: string | null) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(documents)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.orgId, tenantId)))
      .returning();
    return result;
  }

  /**
   * Atomically deactivates the current active version (if any) and inserts a
   * new one, with the version number incremented from whatever came before.
   * Used both for the initial upload (no prior version — number starts at 1)
   * and for re-uploading a replacement file for an existing document.
   */
  async createNewVersion(
    tenantId: string,
    documentId: string,
    data: { filePath: string; fileHash: string; fileSizeBytes: number }
  ) {
    this.requireTenant(tenantId);
    return this.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ versionNumber: documentVersions.versionNumber })
        .from(documentVersions)
        .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.orgId, tenantId)))
        .orderBy(desc(documentVersions.versionNumber))
        .limit(1);

      await tx
        .update(documentVersions)
        .set({ isActive: false })
        .where(and(
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.orgId, tenantId),
          eq(documentVersions.isActive, true)
        ));

      const [version] = await tx.insert(documentVersions).values({
        documentId,
        orgId: tenantId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        filePath: data.filePath,
        fileHash: data.fileHash,
        fileSizeBytes: data.fileSizeBytes,
        isActive: true,
      }).returning();

      return version!;
    });
  }

  /** Syncs the documents row's denormalized file info after a new version replaces it. */
  async updateFileInfo(tenantId: string, id: string, data: { fileHash: string; fileSizeBytes: number; status: typeof documents.$inferSelect['status'] }) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(documents)
      .set({ fileHash: data.fileHash, fileSizeBytes: data.fileSizeBytes, status: data.status, errorMessage: null, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.orgId, tenantId)))
      .returning();
    return result;
  }

  async updateNotes(tenantId: string, id: string, notes: string | null) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(documents)
      .set({ notes, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.orgId, tenantId)))
      .returning();
    return result;
  }
}
