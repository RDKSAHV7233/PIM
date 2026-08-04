import { AccountSecurityClient } from "@/components/settings/account-security-client";
import { redirect } from "next/navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { ApiHttpError, getBillingPlanTier, getMfaStatus, getTenantAuthPolicy } from "@/lib/api";

export const dynamic = "force-dynamic";

function isSecurityApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

export default async function AccountSecurityPage() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/settings/security", 401));
  }
  const claims = await getServerSessionClaims();
  const requestOptions = { role: actorRole, authHeader };

  let mfaStatus = null;
  let mfaStatusState: "available" | "unavailable" = "available";
  let policyState: "available" | "unavailable" = "available";
  let planState: "available" | "unavailable" = "available";
  let mfaRequired: boolean | null = null;
  let planTier: string | null = null;

  try {
    mfaStatus = await getMfaStatus(requestOptions);
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/settings/security", 401));
    }
    if (isSecurityApiUnavailable(error)) {
      mfaStatusState = "unavailable";
    } else {
      mfaStatusState = "unavailable";
    }
  }

  try {
    const policy = await getTenantAuthPolicy(requestOptions);
    mfaRequired = policy.mfaRequired;
  } catch (error) {
    if (isSecurityApiUnavailable(error)) {
      policyState = "unavailable";
    } else {
      policyState = "unavailable";
    }
  }

  try {
    const planProfile = await getBillingPlanTier(requestOptions);
    planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();
  } catch (error) {
    if (isSecurityApiUnavailable(error)) {
      planState = "unavailable";
    } else {
      planState = "unavailable";
    }
  }

  return (
    <AccountSecurityClient
      mfaStatus={mfaStatus}
      mfaRequired={mfaRequired}
      mfaStatusState={mfaStatusState}
      policyState={policyState}
      role={actorRole}
      assignedRoles={(claims?.assignedRoles ?? []) as string[]}
      planTier={planTier}
      planState={planState}
    />
  );
}
