import { AccountSecurityClient } from "@/components/settings/account-security-client";
import { redirect } from "next/navigation";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { getMfaStatus, getTenantAuthPolicy } from "@/lib/api";
import { ApiHttpError } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const authHeader = await getServerAuthHeader();
  if (!authHeader) {
    redirect(buildLoginRedirect("/settings/security", 401));
  }
  const actorRole = await getServerActorRole();
  const requestOptions = { role: actorRole, authHeader };

  let mfaStatus = null;
  let mfaRequired = false;

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

  return (
    <AccountSecurityClient
      mfaStatus={mfaStatus}
      mfaRequired={mfaRequired}
    />
  );
}
