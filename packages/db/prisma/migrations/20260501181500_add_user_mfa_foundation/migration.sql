CREATE TABLE IF NOT EXISTS "user_mfa_enrollments" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'totp',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "secret_encrypted" TEXT NOT NULL,
  "secret_key_version" TEXT NOT NULL DEFAULT 'v1',
  "secret_preview" TEXT,
  "enrolled_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_mfa_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_mfa_enrollment_tenant_user_method_unique"
  ON "user_mfa_enrollments"("tenantKey", "userId", "method");

CREATE INDEX IF NOT EXISTS "idx_user_mfa_enrollment_tenant_user_status"
  ON "user_mfa_enrollments"("tenantKey", "userId", "status");

CREATE TABLE IF NOT EXISTS "user_mfa_backup_codes" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "enrollment_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_mfa_backup_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_mfa_backup_codes_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "user_mfa_enrollments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_user_mfa_backup_code_lookup"
  ON "user_mfa_backup_codes"("tenantKey", "userId", "enrollment_id");

CREATE INDEX IF NOT EXISTS "idx_user_mfa_backup_code_consumed"
  ON "user_mfa_backup_codes"("tenantKey", "userId", "consumed_at");
