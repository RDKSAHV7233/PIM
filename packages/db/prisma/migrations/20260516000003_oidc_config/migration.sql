-- INC-39: OIDC SSO config per tenant (RG-C1 completion)

CREATE TABLE "oidc_configs" (
    "id"               TEXT NOT NULL,
    "tenantKey"        TEXT NOT NULL,
    "issuer"           TEXT NOT NULL,
    "clientId"         TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "client_secret_key_version" TEXT NOT NULL DEFAULT 'v1',
    "callback_url"     TEXT NOT NULL,
    "scopes"           TEXT[] NOT NULL DEFAULT ARRAY['openid','email','profile'],
    "claims_mapping"   JSONB NOT NULL DEFAULT '{}',
    "status"           TEXT NOT NULL DEFAULT 'active',
    "created_by"       TEXT,
    "updated_by"       TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "oidc_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oidc_configs_tenantKey_key" ON "oidc_configs"("tenantKey");
CREATE INDEX "oidc_configs_tenantKey_status_idx" ON "oidc_configs"("tenantKey", "status");
