-- RG-C5: Workflow collaboration and SLA model
--
-- Adds three capabilities to the product workflow:
--   1. Assignee — nullable actorId on Product tracks who owns the current review
--   2. ChangeRequest — reviewer requests changes before approving; resolves when
--      the author re-submits the product for review
--   3. WorkflowSla — per-tenant configurable review SLA target (days);
--      slaDeadlineAt on Product is set when status moves to in_review

-- 1. Assignee and SLA deadline columns on Product
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "assignee_id"    TEXT,
  ADD COLUMN IF NOT EXISTS "sla_deadline_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "idx_product_tenant_assignee"
  ON "Product" ("tenantKey", "assignee_id");

CREATE INDEX IF NOT EXISTS "idx_product_tenant_sla_deadline"
  ON "Product" ("tenantKey", "sla_deadline_at");

-- 2. ChangeRequestStatus enum
DO $$ BEGIN
  CREATE TYPE "ChangeRequestStatus" AS ENUM ('open', 'resolved');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 3. ChangeRequest table
CREATE TABLE IF NOT EXISTS "change_requests" (
  "id"              TEXT        NOT NULL PRIMARY KEY,
  "tenant_key"      TEXT        NOT NULL DEFAULT 'default',
  "product_id"      TEXT        NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "requester_id"    TEXT        NOT NULL,
  "requester_role"  TEXT        NOT NULL,
  "reason"          TEXT        NOT NULL,
  "status"          "ChangeRequestStatus" NOT NULL DEFAULT 'open',
  "resolved_at"     TIMESTAMPTZ,
  "resolved_by_id"  TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_change_requests_tenant_product_status"
  ON "change_requests" ("tenant_key", "product_id", "status");

ALTER TABLE "change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_requests" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'change_requests'
      AND policyname = 'tenant_isolation_change_requests'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_change_requests ON "change_requests"
      USING ("tenant_key" = ' || tenant_expr || ')
      WITH CHECK ("tenant_key" = ' || tenant_expr || ')';
  END IF;
END $$;

-- 4. WorkflowSla table
CREATE TABLE IF NOT EXISTS "workflow_sla" (
  "id"                  TEXT        NOT NULL PRIMARY KEY,
  "tenant_key"          TEXT        NOT NULL UNIQUE DEFAULT 'default',
  "review_target_days"  INTEGER     NOT NULL DEFAULT 3,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "workflow_sla" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_sla" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workflow_sla'
      AND policyname = 'tenant_isolation_workflow_sla'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_workflow_sla ON "workflow_sla"
      USING ("tenant_key" = ' || tenant_expr || ')
      WITH CHECK ("tenant_key" = ' || tenant_expr || ')';
  END IF;
END $$;
