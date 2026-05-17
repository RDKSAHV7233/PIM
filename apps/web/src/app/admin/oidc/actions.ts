"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiHttpError, deleteOidcConfig, upsertOidcConfig } from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

async function requireAdminOptions() {
  const authHeader = await getServerAuthHeader();
  const role = await getServerActorRole();
  if (role !== "admin" || !authHeader) {
    throw new Error("Admin role is required.");
  }
  return { authHeader, role };
}

export async function saveOidcConfigAction(formData: FormData) {
  let errorRedirect = "/admin/oidc";
  try {
    await requireAdminOptions();

    const issuer = String(formData.get("issuer") ?? "").trim();
    const clientId = String(formData.get("clientId") ?? "").trim();
    const clientSecret = String(formData.get("clientSecret") ?? "").trim();
    const callbackUrl = String(formData.get("callbackUrl") ?? "").trim();
    const scopesRaw = String(formData.get("scopes") ?? "").trim();
    const claimsMappingRaw = String(formData.get("claimsMapping") ?? "").trim();

    if (!issuer || !clientId || !callbackUrl) {
      const params = new URLSearchParams({ status: "oidc-error", message: "Issuer, Client ID, and Callback URL are required." });
      redirect(`/admin/oidc?${params.toString()}`);
    }

    if (!clientSecret) {
      const params = new URLSearchParams({ status: "oidc-error", message: "Client Secret is required when saving or updating the OIDC configuration." });
      redirect(`/admin/oidc?${params.toString()}`);
    }

    const scopes = scopesRaw
      ? scopesRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
      : ["openid", "email", "profile"];

    let claimsMapping: Record<string, unknown> = {};
    if (claimsMappingRaw) {
      try {
        const parsed = JSON.parse(claimsMappingRaw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          claimsMapping = parsed as Record<string, unknown>;
        }
      } catch {
        const params = new URLSearchParams({ status: "oidc-error", message: "Claims mapping must be valid JSON." });
        redirect(`/admin/oidc?${params.toString()}`);
      }
    }

    const options = await requireAdminOptions();
    await upsertOidcConfig({ issuer, clientId, clientSecret, callbackUrl, scopes, claimsMapping }, options);
    revalidatePath("/admin/oidc");
  } catch (error) {
    if (error instanceof ApiHttpError) {
      const params = new URLSearchParams({ status: "oidc-error", message: `API error ${error.status}: ${error.message}` });
      redirect(`${errorRedirect}?${params.toString()}`);
    }
    throw error;
  }
  redirect("/admin/oidc?status=oidc-saved");
}

export async function deleteOidcConfigAction() {
  try {
    const options = await requireAdminOptions();
    await deleteOidcConfig(options);
    revalidatePath("/admin/oidc");
  } catch (error) {
    if (error instanceof ApiHttpError) {
      const params = new URLSearchParams({ status: "oidc-error", message: `Failed to remove OIDC config: ${error.message}` });
      redirect(`/admin/oidc?${params.toString()}`);
    }
    throw error;
  }
  redirect("/admin/oidc?status=oidc-deleted");
}
