-- Indexes for the tenant-scoped access paths. Until now only primary keys and a few unique
-- constraints existed, so every query filtered by org_id/user_id/document_id with a sequential scan
-- (including the chunk search, across ALL tenants' chunks) and every cascade delete (library purge,
-- document purge) scanned the referencing tables.
--
-- NOTE: the 2048-dim `embedding` column cannot take an HNSW/IVFFlat index (pgvector limits `vector`
-- indexes to 2000 dims); vector search is therefore an exact scan over the *org's active chunks*,
-- which is what idx_chunks_org_active narrows it to.
CREATE INDEX IF NOT EXISTS "idx_chunks_org_active" ON "document_chunks" ("org_id") WHERE "is_active";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_document" ON "document_chunks" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_version" ON "document_chunks" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_org_live" ON "documents" ("org_id", "created_at" DESC) WHERE NOT "is_deleted";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_folder" ON "documents" ("folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_deleted" ON "documents" ("deleted_at") WHERE "is_deleted";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_versions_document" ON "document_versions" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_versions_org" ON "document_versions" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memberships_org" ON "memberships" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_user_org" ON "conversations" ("user_id", "org_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_org" ON "conversations" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages" ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_org" ON "messages" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_citations_message" ON "citations" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_citations_document" ON "citations" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_citations_chunk" ON "citations" ("chunk_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_citations_org" ON "citations" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_document" ON "ingestion_jobs" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_org_status" ON "ingestion_jobs" ("org_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_folders_org_parent" ON "folders" ("org_id", "parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orgs_archived" ON "organizations" ("updated_at") WHERE NOT "is_active";
