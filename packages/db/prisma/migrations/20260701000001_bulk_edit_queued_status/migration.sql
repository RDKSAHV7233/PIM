ALTER TYPE "BulkEditOperationStatus" ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE "BulkEditOperationStatus" ADD VALUE IF NOT EXISTS 'completed_with_errors';

ALTER TABLE "BulkEditOperation" ALTER COLUMN "status" SET DEFAULT 'queued';
