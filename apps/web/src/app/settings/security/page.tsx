import { AccountSecurityClient } from "@/components/settings/account-security-client";
import { redirect } from "next/navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { getMfaStatus, getTenantAuthPolicy, getBillingPlanProfile } from "@/lib/api";
import { ApiHttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/settings/security", 401));
  }
  const claims = await getServerSessionClaims();
  const requestOptions = { role: actorRole, authHeader };

  let mfaStatus = null;
  let mfaRequired = false;
  let planTier = "TRIAL";

  try {
    mfaStatus = await getMfaStatus(requestOptions);
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/settings/security", 401));
    }
  }

  try {
    const policy = await getTenantAuthPolicy(requestOptions);
    mfaRequired = policy.mfaRequired;
  } catch {
    // policy unavailable — continue without it
  }

  try {
    const planProfile = await getBillingPlanProfile(requestOptions);
    planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();
  } catch {
    // billing unavailable — default to TRIAL gate (safest)
  }

  return (
    <AccountSecurityClient
      mfaStatus={mfaStatus}
      mfaRequired={mfaRequired}
      role={actorRole}
      assignedRoles={(claims?.assignedRoles ?? []) as string[]}
      planTier={planTier}
    />
  );
}
