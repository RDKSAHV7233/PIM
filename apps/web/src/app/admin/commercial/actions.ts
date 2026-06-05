"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import {
  setTenantPlanTier,
  updateUpgradeRequestStatus,
} from "@/lib/api/commercial-ops";

async function requireAdmin(): Promise<string> {
  const { actorRole } = await getServerSession();
  if (actorRole !== "admin") throw new Error("Admin role required");
  return actorRole;
}

function resolveOperatorId(formData: FormData): string {
  return String(formData.get("operatorId") ?? "admin").trim() || "admin";
}

export async function changePlanTierAction(formData: FormData) {
  await requireAdmin();
  const tenantKey = String(formData.get("tenantKey") ?? "").trim();
  const planTier = String(formData.get("planTier") ?? "").trim().toUpperCase();
  const operatorId = resolveOperatorId(formData);

  if (!tenantKey || !["STARTER", "GROWTH", "ENTERPRISE"].includes(planTier)) {
    redirect("/admin/commercial?error=invalid_input");
    return;
  }

  try {
    await setTenantPlanTier(tenantKey, planTier, operatorId);
    revalidatePath("/admin/commercial");
    redirect(`/admin/commercial?success=tier_changed&tenant=${encodeURIComponent(tenantKey)}&tier=${planTier}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    redirect(`/admin/commercial?error=${encodeURIComponent(message)}`);
  }
}

export async function resolveUpgradeRequestAction(formData: FormData) {
  await requireAdmin();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const status = String(formData.get("status") ?? "resolved").trim();
  const operatorId = resolveOperatorId(formData);

  if (!requestId) {
    redirect("/admin/commercial?error=missing_request_id");
    return;
  }

  try {
    await updateUpgradeRequestStatus(requestId, status, operatorId);
    revalidatePath("/admin/commercial");
    redirect(`/admin/commercial?success=request_${status}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    redirect(`/admin/commercial?error=${encodeURIComponent(message)}`);
  }
}
