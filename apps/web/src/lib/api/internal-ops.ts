import type { ApiRequestOptions } from "./core";
import { fetchJson } from "./core";

export type InternalOpsCardAvailability = "available" | "unavailable";

export interface InternalOpsWindow {
  dateFrom: string;
  dateTo: string;
}

export interface InternalOpsStatusCount {
  status: string;
  count: number;
}

export interface InternalOpsSummaryResponse {
  asOf: string;
  windows: {
    operational: InternalOpsWindow;
    inventory: InternalOpsWindow;
    stuckThresholdHours: number;
    queryTimeoutMs: number;
  };
  jobs: {
    availability: InternalOpsCardAvailability;
    active: number;
    stuck: number;
    failed: number;
    deadLetter: number;
    marketplaceExportJobs: InternalOpsStatusCount[];
    bulkImportJobs: InternalOpsStatusCount[];
    errorMessage: string | null;
  };
  imports: {
    availability: InternalOpsCardAvailability;
    activeRuns: number;
    failedRows: number;
    dlqRows: number;
    runFailedRows: number;
    jobFailedRows: number;
    runDlqRows: number;
    jobDlqRows: number;
    errorMessage: string | null;
  };
  publishing: {
    availability: InternalOpsCardAvailability;
    exports: {
      success: number;
      failed: number;
      successRate: number;
    };
    submissions: {
      success: number;
      failed: number;
      successRate: number;
    };
    errorMessage: string | null;
  };
  connectors: {
    availability: InternalOpsCardAvailability;
    totalInstallations: number;
    byStatus: InternalOpsStatusCount[];
    errorMessage: string | null;
  };
  errors: {
    availability: InternalOpsCardAvailability;
    p0p1OpenCount: number;
    storageAvailable: boolean;
    href: "/internal/ops/errors";
    errorMessage: string | null;
  };
  mediaIntegrity: {
    availability: InternalOpsCardAvailability;
    totalAssets: number;
    orphanDetectionIncluded: false;
    errorMessage: string | null;
  };
}

export async function getInternalOpsSummary(options?: ApiRequestOptions) {
  return fetchJson<InternalOpsSummaryResponse>("/internal/ops/summary", undefined, options);
}
