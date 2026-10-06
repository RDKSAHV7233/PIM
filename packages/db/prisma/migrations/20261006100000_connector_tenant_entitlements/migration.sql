-- ADR-0015 section 9 (Sprint 5.1c-2): connector tenant entitlements, a control-plane record of which tenants a
-- connector in a cohort release stage (controlled_pilot, early_access) is released to.
--
-- Expand step only: one new table, no existing table touched, nothing reads or writes it yet. Deploying this is a
-- no-op for application behavior. The evaluator's release_allowed condition reads it in a later change (5.1c-3).
--
-- Model (append and revoke, never edit in place):
--   * a grant is one row; ending it is setting revoked_at/revoked_by/revoke_reason once, nothing else changes
--   * controlled_pilot: Product or Operations grants a named tenant explicitly
--   * early_access: the tenant explicitly opts in AND the entitlement is recorded (never plan-wide enrollment)
--   * live has no cohort and therefore no entitlement row (release_stage is limited to the two cohort stages)
--   * a grant may carry a validity window; an expired or revoked grant is not an entitlement
--
-- Why the guards live in the database: the rules above are an audit trail. CHECK constraints keep a malformed or
-- unattributed grant out, a partial unique index allows one live grant per (tenant, connector, stage), and a trigger
-- rejects edits and deletes so history cannot be rewritten.
--
-- Access: the table has a tenant_key and is row-level-secured. A tenant can READ only its own rows (the evaluator
-- reads them under the tenant context). There is deliberately NO write policy, and RLS is FORCEd, so a role that is
-- subject to RLS cannot write at all: grants are made by a platform operator through a role with BYPASSRLS. Whether
-- production's application role bypasses RLS is the open production RLS evidence item (docs/decisions/
-- DR-2026-10-05-woocommerce-p1-governance.md, D4); until that is recorded this is the intended, not the proven, boundary.
-- Nothing writes to the table yet, so there is no write path to be denied.
--
-- Rollback (safe while nothing writes the table; dropping it discards any grants):
--   DROP TABLE IF EXISTS connector_tenant_entitlements;
--   DROP FUNCTION IF EXISTS connector_tenant_entitlements_guard();

CREATE TABLE IF NOT EXISTS "connector_tenant_entitlements" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL,
  "connector_slug" TEXT NOT NULL,
  "release_stage" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "valid_until" TIMESTAMPTZ,
  "approved_by" TEXT NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "tenant_opted_in_at" TIMESTAMPTZ,
  "tenant_opted_in_by" TEXT,
  "revoked_at" TIMESTAMPTZ,
  "revoked_by" TEXT,
  "revoke_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "connector_tenant_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "connector_tenant_entitlements_stage_check"
    CHECK ("release_stage" IN ('controlled_pilot', 'early_access')),
  CONSTRAINT "connector_tenant_entitlements_slug_check"
    CHECK ("connector_slug" = lower(btrim("connector_slug")) AND length("connector_slug") > 0),
  CONSTRAINT "connector_tenant_entitlements_tenant_check"
    CHECK (length(btrim("tenant_key")) > 0),
  CONSTRAINT "connector_tenant_entitlements_attribution_check"
    CHECK (length(btrim("approved_by")) > 0 AND length(btrim("reason")) > 0 AND length(btrim("source")) > 0),
  CONSTRAINT "connector_tenant_entitlements_window_check"
    CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  CONSTRAINT "connector_tenant_entitlements_opt_in_pair_check"
    CHECK (("tenant_opted_in_at" IS NULL) = ("tenant_opted_in_by" IS NULL)),
  CONSTRAINT "connector_tenant_entitlements_early_access_opt_in_check"
    CHECK ("release_stage" <> 'early_access' OR ("tenant_opted_in_at" IS NOT NULL AND length(btrim("tenant_opted_in_by")) > 0)),
  CONSTRAINT "connector_tenant_entitlements_revocation_check"
    CHECK (
      ("revoked_at" IS NULL) = ("revoked_by" IS NULL)
      AND ("revoked_at" IS NULL) = ("revoke_reason" IS NULL)
      AND ("revoked_by" IS NULL OR (length(btrim("revoked_by")) > 0 AND length(btrim("revoke_reason")) > 0))
    )
);

-- Lookup by tenant and connector (the evaluator's read).
CREATE INDEX IF NOT EXISTS "idx_connector_tenant_entitlements_tenant_connector"
  ON "connector_tenant_entitlements" ("tenant_key", "connector_slug");

-- One live (unrevoked) grant per tenant, connector and stage. To replace a grant, revoke it first.
-- A partial index cannot be expressed in schema.prisma; it is part of this migration only.
CREATE UNIQUE INDEX IF NOT EXISTS "connector_tenant_entitlements_live_grant_unique"
  ON "connector_tenant_entitlements" ("tenant_key", "connector_slug", "release_stage")
  WHERE "revoked_at" IS NULL;

-- Append and revoke only: the one permitted change to a row is recording its revocation, once.
CREATE OR REPLACE FUNCTION connector_tenant_entitlements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'connector_tenant_entitlements rows cannot be deleted; revoke the grant instead';
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'connector_tenant_entitlements: a revoked grant is final';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_key IS DISTINCT FROM OLD.tenant_key
    OR NEW.connector_slug IS DISTINCT FROM OLD.connector_slug
    OR NEW.release_stage IS DISTINCT FROM OLD.release_stage
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.tenant_opted_in_at IS DISTINCT FROM OLD.tenant_opted_in_at
    OR NEW.tenant_opted_in_by IS DISTINCT FROM OLD.tenant_opted_in_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'connector_tenant_entitlements: a grant cannot be edited, only revoked';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS connector_tenant_entitlements_append_only ON "connector_tenant_entitlements";
CREATE TRIGGER connector_tenant_entitlements_append_only
BEFORE UPDATE OR DELETE ON "connector_tenant_entitlements"
FOR EACH ROW
EXECUTE FUNCTION connector_tenant_entitlements_guard();

ALTER TABLE "connector_tenant_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_tenant_entitlements" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'connector_tenant_entitlements' AND policyname = 'tenant_read_connector_tenant_entitlements'
  ) THEN
    -- SELECT only. No INSERT, UPDATE or DELETE policy exists, so those are denied to any role subject to RLS.
    EXECUTE format(
      'CREATE POLICY tenant_read_connector_tenant_entitlements ON "connector_tenant_entitlements" FOR SELECT USING ("tenant_key" = %s)',
      tenant_expr
    );
  END IF;
END
$$;
