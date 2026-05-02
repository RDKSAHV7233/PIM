CREATE TABLE IF NOT EXISTS "TenantAuthPolicy" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL,
  "externalIdentityMode" BOOLEAN NOT NULL DEFAULT false,
  "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
  "mfaGracePeriodDays" INTEGER NOT NULL DEFAULT 7,
  "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 240,
  "allowedAuthMethods" TEXT[] NOT NULL DEFAULT ARRAY['password']::TEXT[],
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantAuthPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantAuthPolicy_tenantKey_key" ON "TenantAuthPolicy"("tenantKey");
CREATE INDEX IF NOT EXISTS "TenantAuthPolicy_tenantKey_updatedAt_idx" ON "TenantAuthPolicy"("tenantKey", "updatedAt");
