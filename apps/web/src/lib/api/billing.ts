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

export async function updateBillingContact(
  body: { billingContactEmail?: string | null },
  options?: ApiRequestOptions,
) {
  return postJson<PlanUsageResponse["profile"]>("/billing/billing-contact", body, options);
}
