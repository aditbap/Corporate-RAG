import { eq, and, isNull } from 'drizzle-orm';
import { BaseRepository } from './base.repository';
import { documents, documentVersions } from '../schema/index';

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

  async updateNotes(tenantId: string, id: string, notes: string | null) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(documents)
      .set({ notes, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.orgId, tenantId)))
      .returning();
    return result;
  }
}
