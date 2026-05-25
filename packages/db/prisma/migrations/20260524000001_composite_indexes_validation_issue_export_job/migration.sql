-- no transaction
-- Composite indexes for ValidationIssue and MarketplaceExportJob.
--
-- ValidationIssue — query patterns served:
--   getIssueInbox:  WHERE tenantKey = ? [AND status = ?] [AND productId = ?]
--                   ORDER BY severity ASC, createdAt ASC, id ASC
--   buildIssueInboxSummary: WHERE tenantKey = ? AND severity = ? AND status = ?
--   metrics:        WHERE tenantKey = ? AND severity = 'error' AND createdAt >= ?
--
--   Current single-column indexes ([status], [tenantKey]) force the planner
--   to pick one and then filter/sort in memory. The new composites let the
--   planner satisfy both the filter and the sort order from a single index scan.
--
-- MarketplaceExportJob — query patterns served:
--   job worker poll: WHERE tenantKey = ? AND status IN (?) ORDER BY updatedAt ASC
--   dashboard ops:   WHERE tenantKey = ? AND status IN (?)
--
--   [status, updatedAt] and [tenantKey] are already present but separate;
--   a compound WHERE tenantKey + status cannot use either efficiently.
--   [tenantKey, status, updatedAt] supersedes [status, updatedAt] for all
--   multi-tenant queries and keeps single-tenant queries equally fast.
--
-- CONCURRENTLY: safe to apply against a live database without blocking writes.
-- Prisma migrate-deploy runs this file outside a transaction (required when
-- CONCURRENTLY is present; the file must contain no other statements).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ValidationIssue_tenantKey_status_productId_idx"
    ON "ValidationIssue" ("tenantKey", "status", "productId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ValidationIssue_tenantKey_severity_status_idx"
    ON "ValidationIssue" ("tenantKey", "severity", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketplaceExportJob_tenantKey_status_channel_idx"
    ON "MarketplaceExportJob" ("tenantKey", "status", "channel");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MarketplaceExportJob_tenantKey_status_updatedAt_idx"
    ON "MarketplaceExportJob" ("tenantKey", "status", "updatedAt");
