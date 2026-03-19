import type { ApiRequestOptions, DashboardHealthResponse, DashboardOperationsSummaryResponse } from "./core";
import { fetchJson } from "./core";

export async function getDashboardHealth(options?: ApiRequestOptions) {
  return fetchJson<DashboardHealthResponse>("/dashboard/health", undefined, options);
}

export async function getDashboardOperationsSummary(options?: ApiRequestOptions) {
  return fetchJson<DashboardOperationsSummaryResponse>(
    "/dashboard/operations-summary",
    undefined,
    options,
  );
}
