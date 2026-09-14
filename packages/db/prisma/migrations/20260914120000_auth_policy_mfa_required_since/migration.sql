-- Anchors the MFA grace-period rollout window to the actual policy change
-- (mfaRequired false -> true), not TenantAuthPolicy's own updatedAt, which
-- also moves on unrelated edits (sessionTimeoutMinutes, allowedAuthMethods,
-- etc.) and would incorrectly restart the window on every save.
--
-- NULL is the safe default for existing rows: a tenant that already had
-- mfaRequired=true before this column existed gets no retroactive grace
-- period, matching the immediate-enforcement behavior that shipped before
-- this migration. Only a future false->true transition (set explicitly by
-- AuthPolicyService.updatePolicy) starts a real grace window.

-- AlterTable
ALTER TABLE "TenantAuthPolicy" ADD COLUMN "mfaRequiredSince" TIMESTAMP(3);
