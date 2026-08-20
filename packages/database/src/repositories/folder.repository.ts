import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../client';
import { folders, documents } from '../schema';

export class FolderRepository {
  private get db() { return db; }

  private requireTenant(tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID is required for all database operations');
  }

  async create(tenantId: string, data: Omit<typeof folders.$inferInsert, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>) {
    this.requireTenant(tenantId);
    const [result] = await this.db.insert(folders)
      .values({ ...data, orgId: tenantId })
      .returning();
    return result;
  }

  async list(tenantId: string, parentId?: string | null) {
    this.requireTenant(tenantId);
    
    if (parentId === undefined || parentId === null) {
      return this.db.query.folders.findMany({
        where: and(eq(folders.orgId, tenantId), isNull(folders.parentId)),
        orderBy: (table, { desc }) => [desc(table.createdAt)],
      });
    }

    return this.db.query.folders.findMany({
      where: and(eq(folders.orgId, tenantId), eq(folders.parentId, parentId)),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
  }

  async getById(tenantId: string, id: string) {
    this.requireTenant(tenantId);
    return this.db.query.folders.findFirst({
      where: and(eq(folders.id, id), eq(folders.orgId, tenantId)),
    });
  }

  async delete(tenantId: string, id: string) {
    this.requireTenant(tenantId);
    
    // Check for child folders
    const childFolders = await this.db.query.folders.findFirst({
      where: and(eq(folders.orgId, tenantId), eq(folders.parentId, id))
    });
    
    if (childFolders) {
      throw new Error('FOLDER_NOT_EMPTY');
    }
    
    // Check for documents in folder
    const childDocs = await this.db.query.documents.findFirst({
      where: and(eq(documents.orgId, tenantId), eq(documents.folderId, id), eq(documents.isDeleted, false))
    });
    
    if (childDocs) {
      throw new Error('FOLDER_NOT_EMPTY');
    }

    const [result] = await this.db.delete(folders)
      .where(and(eq(folders.id, id), eq(folders.orgId, tenantId)))
      .returning();
    return result;
  }

  async rename(tenantId: string, id: string, newName: string) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(folders)
      .set({ name: newName, updatedAt: new Date() })
      .where(and(eq(folders.id, id), eq(folders.orgId, tenantId)))
      .returning();
    return result;
  }
}
