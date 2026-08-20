import { eq, and } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { ingestionJobs } from '../schema/index.js';

export class JobRepository extends BaseRepository {
  constructor() {
    super('ingestion_jobs');
  }

  async create(tenantId: string, data: typeof ingestionJobs.$inferInsert) {
    this.requireTenant(tenantId);
    const [result] = await this.db.insert(ingestionJobs).values({
      ...data,
      orgId: tenantId,
    }).returning();
    return result;
  }

  async updateStatus(tenantId: string, id: string, status: typeof ingestionJobs.$inferSelect['status'], currentStage?: string, progress?: any) {
    this.requireTenant(tenantId);
    
    const updateData: any = { 
      status, 
      updatedAt: new Date() 
    };
    
    if (currentStage !== undefined) updateData.currentStage = currentStage;
    if (progress !== undefined) updateData.progress = progress;
    if (status === 'completed' || status === 'failed') updateData.completedAt = new Date();
    if (status === 'parsing') updateData.startedAt = new Date(); // roughly first active state

    const [result] = await this.db.update(ingestionJobs)
      .set(updateData)
      .where(and(eq(ingestionJobs.id, id), eq(ingestionJobs.orgId, tenantId)))
      .returning();
    return result;
  }

  async failJob(tenantId: string, id: string, error: Error) {
    this.requireTenant(tenantId);
    const [result] = await this.db.update(ingestionJobs)
      .set({
        status: 'failed',
        errorMessage: error.message,
        errorDetails: error.stack,
        completedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(ingestionJobs.id, id), eq(ingestionJobs.orgId, tenantId)))
      .returning();
    return result;
  }
}
