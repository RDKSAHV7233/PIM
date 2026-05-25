-- Partial unique index for delta-sync idempotency.
--
-- Enforces: at most one MarketplaceExportJob row per (tenantKey, productId, installationId)
-- when installationId IS NOT NULL.  This covers every job created by queueDeltaSync.
-- Manual export jobs (installationId = NULL) are excluded from the uniqueness check —
-- PostgreSQL treats NULLs as distinct in unique indexes, so those rows never conflict.
--
-- Purpose (why this matters for enterprise-scale sync):
--   queueDeltaSync cursor-paginates over up to 99 999 products.  If the HTTP request
--   times out, the caller retries, or the BullMQ scheduler fires a second overlapping
--   run, we must not create duplicate queued jobs for the same product.  With this
--   index, the upsert in queueDeltaSync is a true no-op for already-queued products
--   and a re-queue operation for previously-failed ones.
--
-- WHERE "installation_id" IS NOT NULL — the partial predicate keeps the index lean
-- (only delta-sync rows) and lets manual export jobs (NULL installationId) remain
-- unconstrained.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_export_job_product_installation"
    ON "MarketplaceExportJob" ("tenantKey", "productId", "installation_id")
    WHERE "installation_id" IS NOT NULL;
