CREATE TABLE IF NOT EXISTS "PublicSignupRequest" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "workspaceSlug" TEXT NOT NULL,
  "adminEmail" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "verificationTokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "acceptedTerms" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicSignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PublicSignupRequest_verificationTokenHash_key"
  ON "PublicSignupRequest" ("verificationTokenHash");

CREATE INDEX IF NOT EXISTS "PublicSignupRequest_workspaceSlug_idx"
  ON "PublicSignupRequest" ("workspaceSlug");

CREATE INDEX IF NOT EXISTS "PublicSignupRequest_adminEmail_idx"
  ON "PublicSignupRequest" ("adminEmail");

CREATE INDEX IF NOT EXISTS "PublicSignupRequest_status_expiresAt_idx"
  ON "PublicSignupRequest" ("status", "expiresAt");
