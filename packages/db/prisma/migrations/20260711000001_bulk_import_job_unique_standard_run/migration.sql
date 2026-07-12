-- Prevent duplicate standard jobs for the same staged run.
-- Large-batch jobs are excluded (they share a runId with distinct batchIndex values).
-- NULL runId values are excluded (legacy inline imports without a staged run).
--
-- FAIL-SAFE: This migration will NOT silently delete duplicates.
-- If pre-existing duplicates are detected, the migration aborts with a
-- diagnostic message listing the offending rows. A DBA must reconcile
-- them manually before re-running the migration.

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT "tenantKey", "runId"
    FROM "BulkImportJob"
    WHERE "jobRole" = 'standard' AND "runId" IS NOT NULL
    GROUP BY "tenantKey", "runId"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION BLOCKED: % duplicate (tenantKey, runId) group(s) found in BulkImportJob '
      'where jobRole = ''standard''. '
      'Run the following diagnostic query to identify them: '
      'SELECT "tenantKey", "runId", COUNT(*) AS dup_count, '
      'array_agg(id ORDER BY "createdAt") AS job_ids, '
      'array_agg(status ORDER BY "createdAt") AS statuses, '
      'array_agg("createdAt" ORDER BY "createdAt") AS created_dates, '
      'array_agg("updatedAt" ORDER BY "createdAt") AS updated_dates '
      'FROM "BulkImportJob" '
      'WHERE "jobRole" = ''standard'' AND "runId" IS NOT NULL '
      'GROUP BY "tenantKey", "runId" '
      'HAVING COUNT(*) > 1; '
      'Reconcile duplicates manually (archive or delete the unwanted rows), then re-run this migration.',
      dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "BulkImportJob_unique_standard_run"
  ON "BulkImportJob" ("tenantKey", "runId")
  WHERE "jobRole" = 'standard' AND "runId" IS NOT NULL;
