-- Add BulkImportRunStatus enum
CREATE TYPE "BulkImportRunStatus" AS ENUM (
  'uploaded',
  'validating',
  'preflight_blocked',
  'preflight_ready',
  'processing',
  'completed',
  'repair_required',
  'failed'
);

-- Create BulkImportRun table
CREATE TABLE "BulkImportRun" (
    "id"                  TEXT NOT NULL,
    "tenantKey"           TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
    "categoryId"          TEXT NOT NULL,
    "status"              "BulkImportRunStatus" NOT NULL DEFAULT 'uploaded',
    "sourceFileKey"       TEXT,
    "sourceName"          TEXT,
    "sourceFormat"        TEXT NOT NULL DEFAULT 'csv',
    "sourceFileSizeBytes" INTEGER,
    "sourceExpiresAt"     TIMESTAMPTZ,
    "totalRows"           INTEGER,
    "acceptedRows"        INTEGER,
    "failedRows"          INTEGER,
    "deadLetterRows"      INTEGER,
    "blockingIssueCount"  INTEGER,
    "warningCount"        INTEGER,
    "estimatedBatchCount" INTEGER,
    "effectiveMode"       TEXT,
    "preflightSummary"    JSONB,
    "maxRetries"          INTEGER NOT NULL DEFAULT 3,
    "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "BulkImportRun_pkey" PRIMARY KEY ("id")
);

-- Indexes for BulkImportRun
CREATE INDEX "BulkImportRun_tenantKey_status_createdAt_idx" ON "BulkImportRun"("tenantKey", "status", "createdAt");
CREATE INDEX "BulkImportRun_tenantKey_categoryId_createdAt_idx" ON "BulkImportRun"("tenantKey", "categoryId", "createdAt");

-- Foreign key: BulkImportRun -> Category
ALTER TABLE "BulkImportRun" ADD CONSTRAINT "BulkImportRun_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS on BulkImportRun (same pattern as BulkImportJob)
ALTER TABLE "BulkImportRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportRun" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'BulkImportRun' AND policyname = 'tenant_isolation_bulk_import_run'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_bulk_import_run ON "BulkImportRun" USING ("tenantKey" = %s)',
      tenant_expr
    );
  END IF;
END
$$;

-- ── Additive columns on BulkImportJob ──────────────────────────────────────────

-- Add run linkage
ALTER TABLE "BulkImportJob" ADD COLUMN IF NOT EXISTS "runId"     TEXT;
ALTER TABLE "BulkImportJob" ADD COLUMN IF NOT EXISTS "batchIndex" INTEGER;
ALTER TABLE "BulkImportJob" ADD COLUMN IF NOT EXISTS "rowStart"   INTEGER;
ALTER TABLE "BulkImportJob" ADD COLUMN IF NOT EXISTS "rowEnd"     INTEGER;
ALTER TABLE "BulkImportJob" ADD COLUMN IF NOT EXISTS "jobRole"    TEXT NOT NULL DEFAULT 'standard';

-- Index on [tenantKey, runId, status]
CREATE INDEX IF NOT EXISTS "BulkImportJob_tenantKey_runId_status_idx"
    ON "BulkImportJob"("tenantKey", "runId", "status");

-- Foreign key: BulkImportJob -> BulkImportRun (nullable)
ALTER TABLE "BulkImportJob" ADD CONSTRAINT "BulkImportJob_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "BulkImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
    NOT VALID;
ALTER TABLE "BulkImportJob" VALIDATE CONSTRAINT "BulkImportJob_runId_fkey";

-- ── Additive columns on BulkImportRow ──────────────────────────────────────────

ALTER TABLE "BulkImportRow" ADD COLUMN IF NOT EXISTS "runId"            TEXT;
ALTER TABLE "BulkImportRow" ADD COLUMN IF NOT EXISTS "rowNumberGlobal"  INTEGER;
ALTER TABLE "BulkImportRow" ADD COLUMN IF NOT EXISTS "rowNumberInBatch" INTEGER;

-- Index on [tenantKey, runId, status]
CREATE INDEX IF NOT EXISTS "BulkImportRow_tenantKey_runId_status_idx"
    ON "BulkImportRow"("tenantKey", "runId", "status");
