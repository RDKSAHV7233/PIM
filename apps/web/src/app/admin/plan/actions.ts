"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiHttpError, createBillingUpgradeRequest } from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

async function requireAdminRequestOptions() {
  const authHeader = await getServerAuthHeader();
  const role = await getServerActorRole();
  if (role !== "admin" || !authHeader) {
    throw new Error("Admin role is required.");
  }
  return { authHeader, role };
}

function resolveReturnTo(formData: FormData): string {
  const days = String(formData.get("days") ?? "").trim();
  return days ? `/admin/plan?days=${encodeURIComponent(days)}` : "/admin/plan";
}

function withRequestStatus(basePath: string, status: string) {
  const url = new URL(basePath, "https://local.tej");
  url.searchParams.set("requestStatus", status);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export async function requestPlanUpgradeAction(formData: FormData) {
  const notes = String(formData.get("notes") ?? "").trim();
  const source = String(formData.get("source") ?? "admin_plan").trim();
  const returnTo = resolveReturnTo(formData);

  try {
    const response = await createBillingUpgradeRequest(
      {
        notes: notes || undefined,
        source: source || "admin_plan",
      },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/plan");
    redirect(withRequestStatus(returnTo, response.created ? "submitted" : "already-open"));
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 403) {
      redirect(withRequestStatus(returnTo, "forbidden"));
    }
    throw error;
  }
}
