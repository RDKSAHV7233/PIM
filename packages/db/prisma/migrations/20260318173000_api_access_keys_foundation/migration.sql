CREATE TABLE "api_access_keys" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL DEFAULT 'default',
    "label" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_access_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_api_access_keys_tenant_created_id"
    ON "api_access_keys"("tenantKey", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_api_access_keys_tenant_revoked_expires"
    ON "api_access_keys"("tenantKey", "revoked_at", "expires_at");
