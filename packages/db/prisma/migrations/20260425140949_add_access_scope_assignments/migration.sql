DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessScopeSubjectType') THEN
    CREATE TYPE "AccessScopeSubjectType" AS ENUM ('user', 'role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessScopeType') THEN
    CREATE TYPE "AccessScopeType" AS ENUM ('category', 'brand', 'channel', 'connector_account');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AccessScopeAssignment" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "subjectType" "AccessScopeSubjectType" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "scopeType" "AccessScopeType" NOT NULL,
  "categoryId" TEXT,
  "connector_installation_id" TEXT,
  "scopeValue" TEXT,
  "actions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccessScopeAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccessScopeAssignment_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_scope_assignment_subject"
  ON "AccessScopeAssignment"("tenantKey", "subjectType", "subjectId");

CREATE INDEX IF NOT EXISTS "idx_scope_assignment_category"
  ON "AccessScopeAssignment"("tenantKey", "scopeType", "categoryId");

CREATE INDEX IF NOT EXISTS "idx_scope_assignment_connector_account"
  ON "AccessScopeAssignment"("tenantKey", "scopeType", "connector_installation_id");

CREATE INDEX IF NOT EXISTS "idx_scope_assignment_scope_value"
  ON "AccessScopeAssignment"("tenantKey", "scopeType", "scopeValue");

CREATE UNIQUE INDEX IF NOT EXISTS "access_scope_assignments_unique"
  ON "AccessScopeAssignment"(
    "tenantKey",
    "subjectType",
    "subjectId",
    "scopeType",
    COALESCE("categoryId", ''),
    COALESCE("connector_installation_id", ''),
    COALESCE("scopeValue", '')
  );

ALTER TABLE "AccessScopeAssignment" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AccessScopeAssignment'
      AND policyname = 'AccessScopeAssignment_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY "AccessScopeAssignment_tenant_isolation" ON "AccessScopeAssignment" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
