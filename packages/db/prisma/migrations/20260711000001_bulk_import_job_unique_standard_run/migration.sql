-- Prevent duplicate standard jobs for the same staged run.
-- Large-batch jobs are excluded (they share a runId with distinct batchIndex values).
-- NULL runId values are excluded (legacy inline imports without a staged run).

-- Remove duplicate standard jobs created before this constraint existed.
-- Keeps the earliest job (by createdAt) for each (tenantKey, runId) pair;
-- deletes newer duplicates that represent accidental double-submits.
DELETE FROM "BulkImportRow"
WHERE "jobId" IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "tenantKey", "runId"
      ORDER BY "createdAt" ASC
    ) AS rn
    FROM "BulkImportJob"
    WHERE "jobRole" = 'standard' AND "runId" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

DELETE FROM "BulkImportJob"
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "tenantKey", "runId"
      ORDER BY "createdAt" ASC
    ) AS rn
    FROM "BulkImportJob"
    WHERE "jobRole" = 'standard' AND "runId" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX "BulkImportJob_unique_standard_run"
  ON "BulkImportJob" ("tenantKey", "runId")
  WHERE "jobRole" = 'standard' AND "runId" IS NOT NULL;
