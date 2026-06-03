import { cache } from "react";
import type {
  ApiRequestOptions,
  PlanUpgradeRequestCreateResponse,
  PlanUpgradeRequestLookupResponse,
  PlanUsageResponse,
} from "./core";
import { fetchJson, postJson } from "./core";

export async function getBillingUsage(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse>("/billing/usage", undefined, options);
}

export async function getBillingPlanProfile(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse["profile"]>("/billing/plan-profile", undefined, options);
}

export async function getBillingUpgradeRequest(options?: ApiRequestOptions) {
  return fetchJson<PlanUpgradeRequestLookupResponse>("/billing/upgrade-request", undefined, options);
}

export async function createBillingUpgradeRequest(
  body: { notes?: string; source?: string },
  options?: ApiRequestOptions,
) {
  return postJson<PlanUpgradeRequestCreateResponse>("/billing/upgrade-request", body, options);
}

export async function createBillingCheckoutSession(
  body: { planTier: string; successUrl?: string; cancelUrl?: string },
  options?: ApiRequestOptions,
) {
  return postJson<{ url: string }>("/billing/checkout-session", body, options);
}

export async function updateBillingContact(
  body: { billingContactEmail?: string | null },
  options?: ApiRequestOptions,
) {
  return postJson<PlanUsageResponse["profile"]>("/billing/billing-contact", body, options);
}

/**
 * React-request-scoped cached version of getBillingUsage.
 * Use in Server Components that co-render /admin/plan and /admin/users
 * in the same request — deduplicated to a single API call.
 *
 * React cache() is per-request; this is NOT a persistent server cache.
 */
export const getCachedBillingUsage = cache(async (
  role: string,
  authHeader: string | undefined,
) => getBillingUsage({ role: role as import("./core").AppRole, authHeader }));
