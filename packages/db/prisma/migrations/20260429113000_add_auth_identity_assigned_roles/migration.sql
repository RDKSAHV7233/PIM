ALTER TABLE "AuthIdentity"
ADD COLUMN IF NOT EXISTS "assigned_roles" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "AuthIdentity"
SET "assigned_roles" = ARRAY[]::TEXT[]
WHERE "assigned_roles" IS NULL;
