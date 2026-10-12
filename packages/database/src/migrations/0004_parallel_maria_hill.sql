DROP TABLE "notes";--> statement-breakpoint
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(2048);