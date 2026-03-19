import type { ApiRequestOptions, PlanUsageResponse } from "./core";
import { fetchJson, postJson } from "./core";

export async function getBillingUsage(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse>("/billing/usage", undefined, options);
}

export async function getBillingPlanProfile(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse["profile"]>("/billing/plan-profile", undefined, options);
}

export async function setBillingPlanTier(
  planTier: "STARTER" | "GROWTH" | "ENTERPRISE",
  options?: ApiRequestOptions,
) {
  return postJson<PlanUsageResponse["profile"]>("/billing/plan-tier", { planTier }, options);
}
