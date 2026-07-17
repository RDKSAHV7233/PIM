-- Replace the existing partial unique index with one scoped to active export-job
-- statuses only.  Terminal jobs (completed, failed, dead_letter, skipped) are no
-- longer constrained — a repeat publish creates a new row instead of mutating the
-- previous historical job.
--
-- Active states: queued, processing, retrying.
--
-- The old index enforced uniqueness for ALL non-NULL installationId rows, which
-- prevented legitimate repeat publishes after a job completed or failed.  The new
-- index allows unlimited terminal rows while ensuring at most one active job per
-- (tenantKey, productId, installation_id) combination.
--
-- queueDeltaSync's Prisma upsert targets this index via ON CONFLICT; PostgreSQL
-- correctly ignores terminal rows when evaluating the partial predicate.
--
-- DEPLOYMENT NOTES
-- ================
--
-- Preflight check (run BEFORE migration):
--
--   SELECT "tenantKey", "productId", installation_id, COUNT(*) AS active_count
--   FROM "MarketplaceExportJob"
--   WHERE installation_id IS NOT NULL
--     AND status IN ('queued', 'processing', 'retrying')
--   GROUP BY "tenantKey", "productId", installation_id
--   HAVING COUNT(*) > 1;
--
--   If this returns rows, resolve the duplicates manually before running
--   the migration.  The CREATE UNIQUE INDEX will fail if duplicates exist
--   among the active-status rows — it does NOT delete or modify any data.
--
-- Lock behavior:
--   DROP INDEX IF EXISTS: acquires AccessExclusiveLock on the index but
--   NOT on the table — existing queries continue.  The lock duration is
--   the time to remove the index metadata (sub-millisecond).
--
--   CREATE UNIQUE INDEX (non-CONCURRENTLY inside a Prisma migration
--   transaction): acquires ShareLock on the table.  Reads continue;
--   writes block until the index build completes.  On a small table
--   (<100K rows) this completes in <1 second.  On larger tables, use
--   the CONCURRENTLY variant below outside the Prisma migration.
--
-- Rollback procedure:
--   DROP INDEX IF EXISTS "uq_export_job_product_installation";
--   CREATE UNIQUE INDEX "uq_export_job_product_installation"
--       ON "MarketplaceExportJob" ("tenantKey", "productId", "installation_id")
--       WHERE "installation_id" IS NOT NULL;
--   (This restores the unconditional unique for all non-NULL rows.)
--
-- For zero-downtime on large tables, run outside Prisma as a manual step:
--   DROP INDEX IF EXISTS "uq_export_job_product_installation";
--   CREATE UNIQUE INDEX CONCURRENTLY "uq_export_job_product_installation"
--       ON "MarketplaceExportJob" ("tenantKey", "productId", "installation_id")
--       WHERE "installation_id" IS NOT NULL
--         AND "status" IN ('queued', 'processing', 'retrying');
--   Then mark the migration as applied:
--     INSERT INTO "_prisma_migrations" (id, checksum, migration_name, applied_steps_count, finished_at)
--     VALUES (gen_random_uuid(), '<checksum>', '20260713000001_active_export_job_partial_unique', 1, NOW());

DROP INDEX IF EXISTS "uq_export_job_product_installation";

CREATE UNIQUE INDEX "uq_export_job_product_installation"
    ON "MarketplaceExportJob" ("tenantKey", "productId", "installation_id")
    WHERE "installation_id" IS NOT NULL
      AND "status" IN ('queued', 'processing', 'retrying');
