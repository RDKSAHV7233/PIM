-- Migration: 20260506194500_bulk_import_large_run_mvp
-- Written as idempotent SQL because 20260506170000_add_bulk_import_run already
-- created BulkImportRunStatus and BulkImportRun in some environments.
-- All DDL is guarded with IF NOT EXISTS / DO-EXCEPTION blocks so this migration
-- is safe to apply after 20260506170000 or on a fresh database.

-- ── BulkImportRunStatus ────────────────────────────────────────────────────────
-- Create if missing; add 'queued' value if enum already exists without it.
DO $$ BEGIN
  CREATE TYPE "BulkImportRunStatus" AS ENUM (
    'uploaded',
    'validating',
    'preflight_blocked',
    'preflight_ready',
    'queued',
    'processing',
    'repair_required',
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "BulkImportRunStatus" ADD VALUE IF NOT EXISTS 'queued';
EXCEPTION WHEN others THEN NULL; END $$;

-- ── New enums (not in 20260506170000) ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "BulkImportRunMode" AS ENUM ('standard', 'large');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BulkImportJobRole" AS ENUM ('standard', 'large_batch');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── BulkImportRun table ────────────────────────────────────────────────────────
-- Create if missing (fresh DB path). On databases where 20260506170000 already
-- created this table, CREATE TABLE IF NOT EXISTS is a no-op and the ALTER TABLE
-- statements below add any columns that are missing.
CREATE TABLE IF NOT EXISTS "BulkImportRun" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL DEFAULT 'default',
    "categoryId" TEXT NOT NULL,
    "status" "BulkImportRunStatus" NOT NULL DEFAULT 'uploaded',
    "sourceFileKey" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceFormat" TEXT NOT NULL,
    "sourceFileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "sourceExpiresAt" TIMESTAMP(3),
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "acceptedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "deadLetterRows" INTEGER NOT NULL DEFAULT 0,
    "blockingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedBatchCount" INTEGER NOT NULL DEFAULT 0,
    "effectiveMode" "BulkImportRunMode",
    "preflightSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BulkImportRun_pkey" PRIMARY KEY ("id")
);

-- Add any columns that 20260506170000 may have created with different types
-- or that it omitted. All are additive and idempotent.
ALTER TABLE "BulkImportRun"
  ADD COLUMN IF NOT EXISTS "sourceFileSizeBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxRetries" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "totalRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "acceptedRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failedRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deadLetterRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "blockingIssueCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "warningCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "estimatedBatchCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "preflightSummary" JSONB,
  ADD COLUMN IF NOT EXISTS "sourceExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceName" TEXT;

-- Migrate effectiveMode from TEXT (170000) to BulkImportRunMode enum if needed.
DO $$ BEGIN
  ALTER TABLE "BulkImportRun"
    ALTER COLUMN "effectiveMode" TYPE "BulkImportRunMode"
    USING "effectiveMode"::"BulkImportRunMode";
EXCEPTION WHEN others THEN NULL; END $$;

-- ── BulkImportJob columns ──────────────────────────────────────────────────────
ALTER TABLE "BulkImportJob"
  ADD COLUMN IF NOT EXISTS "runId" TEXT,
  ADD COLUMN IF NOT EXISTS "batchIndex" INTEGER,
  ADD COLUMN IF NOT EXISTS "rowStart" INTEGER,
  ADD COLUMN IF NOT EXISTS "rowEnd" INTEGER;

-- Migrate jobRole from TEXT (170000) to BulkImportJobRole enum if needed.
DO $$ BEGIN
  ALTER TABLE "BulkImportJob"
    ALTER COLUMN "jobRole" TYPE "BulkImportJobRole"
    USING "jobRole"::"BulkImportJobRole";
  ALTER TABLE "BulkImportJob" ALTER COLUMN "jobRole" SET NOT NULL;
  ALTER TABLE "BulkImportJob" ALTER COLUMN "jobRole" SET DEFAULT 'standard';
EXCEPTION WHEN others THEN NULL; END $$;

-- Add jobRole column if it doesn't exist at all (databases with neither migration).
ALTER TABLE "BulkImportJob"
  ADD COLUMN IF NOT EXISTS "jobRole" "BulkImportJobRole" NOT NULL DEFAULT 'standard';

-- ── BulkImportRow columns ──────────────────────────────────────────────────────
ALTER TABLE "BulkImportRow"
  ADD COLUMN IF NOT EXISTS "runId" TEXT,
  ADD COLUMN IF NOT EXISTS "rowNumberGlobal" INTEGER,
  ADD COLUMN IF NOT EXISTS "rowNumberInBatch" INTEGER;

-- ── Indexes ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "BulkImportRun_tenantKey_status_createdAt_idx"
  ON "BulkImportRun"("tenantKey", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "BulkImportRun_tenantKey_categoryId_createdAt_idx"
  ON "BulkImportRun"("tenantKey", "categoryId", "createdAt");

CREATE INDEX IF NOT EXISTS "BulkImportJob_tenantKey_runId_status_idx"
  ON "BulkImportJob"("tenantKey", "runId", "status");

CREATE INDEX IF NOT EXISTS "BulkImportRow_tenantKey_runId_status_idx"
  ON "BulkImportRow"("tenantKey", "runId", "status");

-- ── Foreign keys ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "BulkImportRun"
    ADD CONSTRAINT "BulkImportRun_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BulkImportJob"
    ADD CONSTRAINT "BulkImportJob_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "BulkImportRun"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BulkImportRow"
    ADD CONSTRAINT "BulkImportRow_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "BulkImportRun"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
