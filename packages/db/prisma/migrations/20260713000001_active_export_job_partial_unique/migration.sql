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

DROP INDEX IF EXISTS "uq_export_job_product_installation";

CREATE UNIQUE INDEX "uq_export_job_product_installation"
    ON "MarketplaceExportJob" ("tenantKey", "productId", "installation_id")
    WHERE "installation_id" IS NOT NULL
      AND "status" IN ('queued', 'processing', 'retrying');
