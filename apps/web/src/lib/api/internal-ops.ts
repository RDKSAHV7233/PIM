import type { ApiRequestOptions } from "./core";
import { fetchJson } from "./core";

export type InternalOpsCardAvailability = "available" | "unavailable";
export type InternalOpsAggregateAvailability = InternalOpsCardAvailability | "partial";
export type InternalOpsReadinessImpact = "BLOCKER" | "WARNING" | "STATUS";
export type InternalOpsReadinessMetric = number | null;

export interface InternalOpsWindow {
  dateFrom: string;
  dateTo: string;
}

export interface InternalOpsStatusCount {
  status: string;
  count: number;
}

export interface InternalOpsReadinessRuleFamilyCount {
  ruleFamily: string;
  impact: Exclude<InternalOpsReadinessImpact, "STATUS">;
  count: number;
}

export interface InternalOpsReadinessStatusCount extends InternalOpsStatusCount {
  impact: InternalOpsReadinessImpact;
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
  readiness: {
    availability: InternalOpsAggregateAvailability;
    asOf: string;
    message: string | null;
    productData: {
      availability: InternalOpsCardAvailability;
      blockedProducts: InternalOpsReadinessMetric;
      blockingIssues: InternalOpsReadinessMetric;
      warningIssues: InternalOpsReadinessMetric;
      affectedTenants: InternalOpsReadinessMetric;
      topRuleFamilies: InternalOpsReadinessRuleFamilyCount[] | null;
    };
    mapping: {
      availability: InternalOpsCardAvailability;
      blockingMappings: InternalOpsReadinessMetric;
      warningMappings: InternalOpsReadinessMetric;
      affectedTenants: InternalOpsReadinessMetric;
      signals: {
        compatibilityBlocked: InternalOpsReadinessMetric;
        remapRequired: InternalOpsReadinessMetric;
        fallbackAckRequired: InternalOpsReadinessMetric;
        deprecated: InternalOpsReadinessMetric;
      };
    };
    connector: {
      availability: InternalOpsCardAvailability;
      blockingInstallations: InternalOpsReadinessMetric;
      warningInstallations: InternalOpsReadinessMetric;
      inconclusiveInstallations: InternalOpsReadinessMetric;
      configurationProblemInstallations: InternalOpsReadinessMetric;
      affectedTenants: InternalOpsReadinessMetric;
      byStatus: InternalOpsReadinessStatusCount[] | null;
    };
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
    latestRun: {
      runId: string;
      status: string;
      startedAt: string;
      completedAt: string | null;
      coverageComplete: boolean;
      rowsExamined: number;
      rowsEligible: number | null;
      continuationPending: boolean;
      totals: {
        missing: number;
        invalidPath: number;
        unverifiable: number;
        storageErrors: number;
      };
      impact: {
        affectedTenantCount: number;
        activeProductImpactCount: number;
      };
    } | null;
    orphanDetectionIncluded: false;
    errorMessage: string | null;
  };
}

export async function getInternalOpsSummary(options?: ApiRequestOptions) {
  return fetchJson<InternalOpsSummaryResponse>("/internal/ops/summary", undefined, options);
}
