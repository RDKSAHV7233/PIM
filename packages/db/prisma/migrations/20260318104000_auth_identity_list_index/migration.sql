CREATE INDEX IF NOT EXISTS "idx_auth_identity_tenant_created_id"
  ON "AuthIdentity" ("tenantKey", "createdAt" DESC, "id" DESC);
