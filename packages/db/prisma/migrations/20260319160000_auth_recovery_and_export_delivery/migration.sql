ALTER TABLE account_export_requests
  ADD COLUMN IF NOT EXISTS artifact_path TEXT,
  ADD COLUMN IF NOT EXISTS artifact_file_name TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS "AuthRecoveryToken" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "AuthRecoveryToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthRecoveryToken_tokenHash_key"
  ON "AuthRecoveryToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "idx_auth_recovery_token_lookup"
  ON "AuthRecoveryToken"("tenantKey", "userId", "purpose", "createdAt" DESC);
