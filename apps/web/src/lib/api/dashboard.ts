import type {
  ApiRequestOptions,
  DashboardHealthResponse,
  DashboardOperationsSummaryResponse,
  KpiTrendsResponse,
} from "./core";
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

export async function getKpiTrends(
  query?: { days?: number },
  options?: ApiRequestOptions,
) {
  const searchParams = new URLSearchParams();
  if (query?.days != null) {
    searchParams.set("days", String(query.days));
  }
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  return fetchJson<KpiTrendsResponse>(`/metrics/kpi-trends${suffix}`, undefined, options);
}
