"use server";

// OIDC IdP configuration is auth-critical. Mutations require both:
//   1. Admin role (enforced here AND by @Roles("admin") on the controller).
//   2. Fresh step-up password proof scoped to STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
//      enforced by @RequireStepUp on the controller (apps/api/src/auth/oidc.controller.ts).
// The step-up token is short-lived and bound to the parent session; see StepUpGuard
// for the invariants (parentJti, tenantId, sub, scope must all match).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteOidcConfig,
  issueStepUp,
  upsertOidcConfig,
} from "@/lib/api";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

const STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK = "auth_config_high_risk";
const STEP_UP_TOKEN_HEADER = "x-pim-step-up-token";

async function requireSystemAdminRequestOptions() {
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  if (!authHeader) {
    throw new Error("Authenticated session is required.");
  }
  if (actorRole !== "admin" || !isSystemAdminBoundary(adminBoundaryRoles)) {
    throw new Error("Security admin access is required.");
  }
  return { role: actorRole, authHeader };
}

function buildRedirect(status: string, message?: string) {
  const url = new URL("/admin/auth-policy/oidc", "http://localhost");
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  return `${url.pathname}${url.search}`;
}

function parseScopes(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseClaimsMapping(input: string): Record<string, unknown> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Claims mapping must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Claims mapping is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function issueAuthConfigStepUpToken(formData: FormData): Promise<string> {
  const password = String(formData.get("stepUpPassword") ?? "").trim();
  if (!password) {
    throw new Error("STEP_UP_PASSWORD_REQUIRED");
  }
  const response = await issueStepUp(
    { password, scope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK },
    await requireSystemAdminRequestOptions(),
  );
  const token = String(response.stepUpToken ?? "").trim();
  if (!token) {
    throw new Error("Step-up token issuance returned no token.");
  }
  return token;
}

export async function upsertOidcConfigAction(formData: FormData) {
  const issuer = String(formData.get("issuer") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const callbackUrl = String(formData.get("callbackUrl") ?? "").trim();
  const scopesInput = String(formData.get("scopes") ?? "").trim();
  const claimsInput = String(formData.get("claimsMapping") ?? "").trim();

  try {
    if (!issuer || !clientId || !clientSecret || !callbackUrl) {
      throw new Error("Issuer, client ID, client secret, and callback URL are required.");
    }
    const scopes = parseScopes(scopesInput);
    const claimsMapping = parseClaimsMapping(claimsInput);
    const stepUpToken = await issueAuthConfigStepUpToken(formData);
    const adminOptions = await requireSystemAdminRequestOptions();
    await upsertOidcConfig(
      {
        issuer,
        clientId,
        clientSecret,
        callbackUrl,
        scopes: scopes.length ? scopes : undefined,
        claimsMapping,
      },
      {
        ...adminOptions,
        headers: { [STEP_UP_TOKEN_HEADER]: stepUpToken },
      },
    );
    revalidatePath("/admin/auth-policy/oidc");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save OIDC configuration.";
    if (message === "STEP_UP_PASSWORD_REQUIRED") {
      redirect(buildRedirect("oidc-error", "Enter your password to confirm this auth-config change."));
    }
    redirect(buildRedirect("oidc-error", message));
  }
  redirect(buildRedirect("oidc-saved"));
}

export async function deleteOidcConfigAction(formData: FormData) {
  try {
    const stepUpToken = await issueAuthConfigStepUpToken(formData);
    const adminOptions = await requireSystemAdminRequestOptions();
    await deleteOidcConfig({
      ...adminOptions,
      headers: { [STEP_UP_TOKEN_HEADER]: stepUpToken },
    });
    revalidatePath("/admin/auth-policy/oidc");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete OIDC configuration.";
    if (message === "STEP_UP_PASSWORD_REQUIRED") {
      redirect(buildRedirect("oidc-error", "Enter your password to confirm removing OIDC sign-in."));
    }
    redirect(buildRedirect("oidc-error", message));
  }
  redirect(buildRedirect("oidc-deleted"));
}
