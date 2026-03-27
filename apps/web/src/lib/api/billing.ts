import type { ApiRequestOptions, PlanUsageResponse } from "./core";
import { fetchJson } from "./core";

export async function getBillingUsage(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse>("/billing/usage", undefined, options);
}

export async function getBillingPlanProfile(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse["profile"]>("/billing/plan-profile", undefined, options);
}
