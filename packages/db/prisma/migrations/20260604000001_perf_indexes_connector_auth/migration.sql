-- Migration: perf_indexes_connector_auth
-- Adds three missing composite indexes identified in the deep CTO optimization audit.
--
-- 1. connector_installations(tenant_key, connector_id)
--    advancedSearchProducts queries installations filtered by connectorId — the existing
--    (tenantKey, installedAt, id) index does not cover this filter efficiently.
--
-- 2. connector_submissions(tenant_key, installation_id, product_id)
--    advancedSearchProducts fetches distinct productIds per installation.
--    The new index enables an index-only scan for this DISTINCT query pattern.
--
-- 3. auth_identity(tenant_key, user_id)
--    The login hot-path calls findFirst({ where: { tenantKey, userId } }).
--    userId has a @unique index but it covers userId alone; the composite index
--    makes multi-tenant query plans consistent and avoids post-scan tenantKey filtering.
--
-- NOTE: CONCURRENTLY omitted — Prisma wraps migrations in a transaction block and
-- CREATE INDEX CONCURRENTLY cannot run inside one (PostgreSQL error 25001).
-- If applying to a large production table that requires zero-lock index creation,
-- run these three statements manually with CONCURRENTLY outside a transaction
-- BEFORE this migration file is applied (IF NOT EXISTS makes it idempotent).

CREATE INDEX IF NOT EXISTS "idx_connector_installations_tenant_connector_id"
  ON "connector_installations" ("tenant_key", "connector_id");

CREATE INDEX IF NOT EXISTS "idx_connector_submissions_tenant_installation_product"
  ON "connector_submissions" ("tenant_key", "installation_id", "product_id");

CREATE INDEX IF NOT EXISTS "idx_auth_identity_tenant_user_id"
  ON "AuthIdentity" ("tenantKey", "userId");
