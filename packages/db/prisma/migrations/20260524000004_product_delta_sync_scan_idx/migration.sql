-- no transaction
-- Index to support fetchDeltaCandidatesPage — the cursor-paginated LEFT JOIN query
-- that powers enterprise-scale delta sync candidate detection.
--
-- The query pattern:
--   WHERE p."tenantKey" = $1
--     AND p.status      = 'approved'
--     AND p."deletedAt" IS NULL
--     AND p.id          > $cursor          -- keyset pagination
--   ORDER BY p.id ASC
--   LIMIT 200
--
-- Without this index the planner uses (tenantKey, status) to identify all approved
-- products for the tenant, then evaluates deletedAt and id filters in memory on
-- every 200-row page.  For an ENTERPRISE tenant with 99 999 approved products that
-- means ~99 999 row evaluations per page × 500 pages = ~50 M row evaluations per
-- full-catalog queue run.
--
-- With (tenantKey, status, deletedAt, id) the planner can do a tight keyset scan:
--   Index range: tenantKey = X  AND  status = 'approved'  AND  deletedAt IS NULL  AND  id > cursor
--   Each 200-row page costs O(log N + 200) regardless of catalog size.
--
-- CONCURRENTLY: safe to apply against a live database without blocking writes.
-- Prisma migrate-deploy runs this file outside a transaction (required when
-- CONCURRENTLY is present; the file must contain no other statements).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_delta_sync_scan"
    ON "Product" ("tenantKey", "status", "deletedAt", "id");
