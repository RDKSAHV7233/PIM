"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiHttpError, createBillingUpgradeRequest, updateBillingContact } from "@/lib/api";
import { getServerSession } from "@/lib/server-session";

async function requireAdminRequestOptions() {
  const { authHeader, actorRole: role } = await getServerSession();
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
  return withStatus(basePath, "requestStatus", status);
}

function withStatus(basePath: string, key: string, status: string) {
  const url = new URL(basePath, "https://local.vexa");
  url.searchParams.set(key, status);
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


export async function updateBillingContactAction(formData: FormData) {
  const rawBillingContactEmail = String(formData.get("billingContactEmail") ?? "").trim();
  const clearRequested = String(formData.get("clear") ?? "").trim().toLowerCase() === "true";
  const returnTo = resolveReturnTo(formData);

  try {
    const response = await updateBillingContact(
      {
        billingContactEmail: clearRequested || rawBillingContactEmail.length === 0 ? null : rawBillingContactEmail,
      },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/plan");
    redirect(withStatus(returnTo, "billingContactStatus", response.billingContactEmail ? "saved" : "cleared"));
  } catch (error) {
    if (error instanceof ApiHttpError) {
      if (error.status === 400) {
        redirect(withStatus(returnTo, "billingContactStatus", "invalid"));
      }
      if (error.status === 403) {
        redirect(withStatus(returnTo, "billingContactStatus", "forbidden"));
      }
    }
    throw error;
  }
}
