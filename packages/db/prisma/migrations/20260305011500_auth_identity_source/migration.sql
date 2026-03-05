-- Auth identity source-of-truth (DB-backed)
CREATE TABLE IF NOT EXISTS "AuthIdentity" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthIdentity_userId_key"
  ON "AuthIdentity"("userId");

CREATE INDEX IF NOT EXISTS "AuthIdentity_tenantKey_role_isActive_idx"
  ON "AuthIdentity"("tenantKey", "role", "isActive");

INSERT INTO "AuthIdentity" ("id", "tenantKey", "userId", "role", "isActive", "createdBy", "createdAt", "updatedAt")
VALUES ('authid_default_admin', 'default', 'admin', 'admin', true, 'migration', NOW(), NOW())
ON CONFLICT ("userId") DO NOTHING;