"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiHttpError, type PlanUpgradeRequest } from "@/lib/api";
import { getCommercialOpsRequestOptions, updateInternalUpgradeRequestStatus } from "@/lib/api/internal-billing";
import { getServerActorRole, getServerSessionClaims } from "@/lib/server-session";

function buildReturnTo(formData: FormData) {
  const url = new URL("/internal/developer", "https://local.tej");
  const tenantQuery = String(formData.get("tenantQuery") ?? "").trim();
  const tenantKey = String(formData.get("tenantKey") ?? "").trim();
  const requestStatusFilter = String(formData.get("requestStatusFilter") ?? "").trim();
  const requestSlaFilter = String(formData.get("requestSlaFilter") ?? "").trim();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (tenantQuery) {
    url.searchParams.set("tenantQuery", tenantQuery);
  }
  if (tenantKey) {
    url.searchParams.set("tenantKey", tenantKey);
  }
  if (requestStatusFilter) {
    url.searchParams.set("requestStatusFilter", requestStatusFilter);
  }
  if (requestSlaFilter) {
    url.searchParams.set("requestSlaFilter", requestSlaFilter);
  }
  if (requestId) {
    url.searchParams.set("requestId", requestId);
  }
  return url;
}

function redirectTo(url: URL) {
  const query = url.searchParams.toString();
  redirect(query ? `${url.pathname}?${query}` : url.pathname);
}

export async function updateUpgradeRequestStatusAction(formData: FormData) {
  const actorRole = await getServerActorRole();
  const claims = await getServerSessionClaims();
  if (process.env.APP_ENV === "production" || actorRole !== "admin" || !claims?.sub) {
    redirect("/internal/developer?actionStatus=forbidden");
  }

  const requestId = String(formData.get("requestId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim().toLowerCase() as PlanUpgradeRequest["status"];
  const returnTo = buildReturnTo(formData);

  try {
    await updateInternalUpgradeRequestStatus(
      {
        requestId,
        status,
      },
      getCommercialOpsRequestOptions(claims.sub, actorRole),
    );
    revalidatePath("/internal/developer");
    returnTo.searchParams.set("actionStatus", status);
    redirectTo(returnTo);
  } catch (error) {
    if (error instanceof ApiHttpError) {
      returnTo.searchParams.set("actionStatus", "error");
      redirectTo(returnTo);
    }
    throw error;
  }
}
