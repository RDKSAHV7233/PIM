"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateTenantAuthPolicy } from "@/lib/api";
import { getServerSession } from "@/lib/server-session";

async function requireAdminRequestOptions() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    throw new Error("Authenticated session is required.");
  }
  if (actorRole !== "admin") {
    throw new Error("Admin role is required.");
  }
  return { role: actorRole, authHeader };
}

function buildRedirect(status: string, message?: string, redirectTo = "/admin/auth-policy") {
  const url = new URL(redirectTo, "http://localhost");
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  return `${url.pathname}${url.search}`;
}

function redirectWithError(message: string, redirectTo = "/admin/auth-policy") {
  redirect(buildRedirect("auth-policy-error", message, redirectTo));
}

function resolveRedirectTarget(formData: FormData, key: string, fallback: string) {
  const raw = String(formData.get(key) ?? "").trim();
  return /^\/(?!\/)/.test(raw) ? raw : fallback;
}

export async function updateTenantAuthPolicyAction(formData: FormData) {
  const errorRedirectTo = resolveRedirectTarget(formData, "errorRedirectTo", "/admin/auth-policy");
  const externalIdentityMode = formData.get("externalIdentityMode") === "on";
  const mfaRequired = formData.get("mfaRequired") === "on";
  const mfaGracePeriodDays = Number.parseInt(String(formData.get("mfaGracePeriodDays") ?? "").trim(), 10);
  const sessionTimeoutMinutes = Number.parseInt(String(formData.get("sessionTimeoutMinutes") ?? "").trim(), 10);
  const allowedAuthMethods = formData
    .getAll("allowedAuthMethods")
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter((entry): entry is "password" | "oidc" => entry === "password" || entry === "oidc");

  try {
    if (!Number.isFinite(mfaGracePeriodDays) || !Number.isFinite(sessionTimeoutMinutes)) {
      throw new Error("Grace period and session timeout are required.");
    }
    if (allowedAuthMethods.length === 0) {
      throw new Error("Select at least one allowed sign-in method.");
    }
    await updateTenantAuthPolicy(
      {
        externalIdentityMode,
        mfaRequired,
        mfaGracePeriodDays,
        sessionTimeoutMinutes,
        allowedAuthMethods,
      },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/auth-policy");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to update tenant auth policy.", errorRedirectTo);
  }

  redirect("/admin/auth-policy?status=auth-policy-updated");
}
