-- Track the timestamp of each user's most recent successful authentication.
--
-- Written by the auth service on successful password login and MFA completion.
-- Readable in the admin workspace-users endpoint so operators can spot dormant
-- accounts and enforce access-review hygiene.
--
-- Nullable: existing rows and non-DB auth modes have no value recorded yet.

ALTER TABLE "AuthIdentity" ADD COLUMN IF NOT EXISTS "last_sign_in_at" TIMESTAMP(3);
